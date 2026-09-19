/**
 * Many controllers in one process.
 *
 * Each device gets its own supervised fiber, so a tool that is unplugged,
 * rejects the handshake or floods the link cannot affect the others. Adding
 * and removing devices at runtime starts and stops exactly one fiber, and
 * closing the pool waits for every connection to release its socket.
 *
 * @since 0.0.0
 */
import { Cause, Deferred, Effect, Fiber, FiberMap, HashMap, Layer, Predicate, Ref, SubscriptionRef } from "effect"
import * as A from "effect/Array"
import * as Context from "effect/Context"
import * as O from "effect/Option"
import * as S from "effect/Schema"
import type { ConnectionState } from "../connection/ConnectionState.ts"
import * as DeviceConnection from "../connection/DeviceConnection.ts"
import type { DeviceConfig } from "../connection/DeviceSettings.ts"
import type { DeviceId } from "../protocol/TighteningResult.ts"
import { Transport } from "../transport/Transport.ts"

/**
 * A device that is already in the pool.
 *
 * @category errors
 * @since 0.0.0
 */
export class DeviceAlreadyAdded extends S.TaggedError<DeviceAlreadyAdded>()("DeviceAlreadyAdded", {
  deviceId: S.String
}) {}

/**
 * The state of one device inside the pool.
 *
 * @category models
 * @since 0.0.0
 */
export interface DeviceStatus {
  readonly deviceId: DeviceId
  readonly state: ConnectionState
  readonly delivered: number
  readonly duplicates: number
}

/**
 * What a running pool offers its callers.
 *
 * @category models
 * @since 0.0.0
 */
export interface DevicePoolService {
  /** Starts a connection for a device and returns once it is supervised. */
  readonly add: (config: DeviceConfig) => Effect.Effect<DeviceConnection.DeviceConnectionService, DeviceAlreadyAdded>
  /** Stops a device and releases its resources. Unknown devices are ignored. */
  readonly remove: (deviceId: DeviceId) => Effect.Effect<void>
  /** The connection of a device, when it is in the pool. */
  readonly get: (deviceId: DeviceId) => Effect.Effect<O.Option<DeviceConnection.DeviceConnectionService>>
  /** A snapshot of every device in the pool. */
  readonly status: Effect.Effect<ReadonlyArray<DeviceStatus>>
}

const make = Effect.fnUntraced(function* () {
  const transport = yield* Transport
  const fibers = yield* FiberMap.make<DeviceId>()
  // A device's place in the pool. The slot is taken before the fiber starts,
  // so two concurrent `add` calls for one identifier cannot both win; the
  // connection fills in once it is supervised.
  const slots = yield* Ref.make(HashMap.empty<DeviceId, O.Option<DeviceConnection.DeviceConnectionService>>())

  /** Runs one device, holding its connection open until a `remove` or the pool closing ends it. */
  const supervise = Effect.fnUntraced(
    function* (config: DeviceConfig, started: Deferred.Deferred<DeviceConnection.DeviceConnectionService>) {
      const connection = yield* Effect.provideService(DeviceConnection.make(config), Transport, transport)
      yield* Ref.update(slots, HashMap.set(config.id, O.some(connection)))
      yield* Deferred.succeed(started, connection)

      return yield* Effect.never
    },
    Effect.scoped,
    (effect, config) => Effect.ensuring(effect, Ref.update(slots, HashMap.remove(config.id))),
    (effect, config) =>
      Effect.tapCauseIf(effect, Predicate.not(Cause.hasInterruptsOnly), (cause) =>
        Effect.annotateLogs(Effect.logError("a device connection stopped", cause), { deviceId: config.id })
      )
  )

  const add = Effect.fnUntraced(function* (config: DeviceConfig) {
    const started = yield* Deferred.make<DeviceConnection.DeviceConnectionService>()

    // Claiming the slot and noticing a duplicate are one atomic step: doing
    // them apart lets two adds for the same device both pass the check.
    const claimed = yield* Ref.modify(slots, (current) =>
      HashMap.has(current, config.id) ? [false, current] : [true, HashMap.set(current, config.id, O.none())]
    )

    if (!claimed) {
      return yield* Effect.fail(new DeviceAlreadyAdded({ deviceId: config.id }))
    }

    const fiber = yield* FiberMap.run(fibers, config.id, supervise(config, started))

    // Only the fiber completes `started`, once the connection is supervised.
    // A fiber that ends before that (a defect in `make`, or a remove or pool
    // close that interrupts it) never will, so its exit answers instead.
    return yield* Effect.raceFirst(Deferred.await(started), Fiber.join(fiber))
  })

  const remove = (deviceId: DeviceId): Effect.Effect<void> => FiberMap.remove(fibers, deviceId)

  const get = (deviceId: DeviceId): Effect.Effect<O.Option<DeviceConnection.DeviceConnectionService>> =>
    Effect.map(Ref.get(slots), (current) => O.flatten(HashMap.get(current, deviceId)))

  const status = Effect.flatMap(Ref.get(slots), (current) =>
    Effect.forEach(A.getSomes(A.fromIterable(HashMap.values(current))), (connection) =>
      Effect.all({
        deviceId: Effect.succeed(connection.deviceId),
        state: SubscriptionRef.get(connection.state),
        delivered: connection.delivered,
        duplicates: connection.duplicates
      })
    )
  )

  return { add, remove, get, status } satisfies DevicePoolService
})

/**
 * Many controllers supervised together.
 *
 * The pool is a service: provide its `layer` over a `Transport` and the
 * layer owns every device fiber, so closing the application closes the
 * connections with it.
 *
 * **Example** (Running two tools at once)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { DeviceId, DevicePool, Endpoint, TcpTransport } from "effect-open-protocol"
 *
 * const program = Effect.gen(function* () {
 *   const pool = yield* DevicePool.DevicePool
 *   yield* pool.add({
 *     id: DeviceId.make("line-1-tool-3"),
 *     endpoint: new Endpoint({ host: "10.0.0.31", port: 4545 })
 *   })
 *   return yield* pool.status
 * })
 *
 * const runnable = program.pipe(
 *   Effect.provide(DevicePool.layer),
 *   Effect.provide(TcpTransport.layer)
 * )
 * ```
 *
 * @category services
 * @since 0.0.0
 */
export class DevicePool extends Context.Service<DevicePool, DevicePoolService>()("effect-open-protocol/DevicePool") {}

/**
 * Provides a pool that supervises its devices for the lifetime of the layer.
 *
 * @category layers
 * @since 0.0.0
 */
export const layer: Layer.Layer<DevicePool, never, Transport> = Layer.effect(DevicePool)(make())
