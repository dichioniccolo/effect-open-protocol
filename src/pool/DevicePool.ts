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
import { Deferred, Effect, FiberMap, HashMap, Layer, pipe, Ref, SubscriptionRef } from "effect"
import * as A from "effect/Array"
import * as Context from "effect/Context"
import * as O from "effect/Option"
import * as S from "effect/Schema"
import type { ConnectionState } from "../connection/ConnectionState.ts"
import { type DeviceConnectionShape, makeDeviceConnection } from "../connection/DeviceConnection.ts"
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
export interface DevicePoolShape {
  /** Starts a connection for a device and returns once it is supervised. */
  readonly add: (config: DeviceConfig) => Effect.Effect<DeviceConnectionShape, DeviceAlreadyAdded>
  /** Stops a device and releases its resources. Unknown devices are ignored. */
  readonly remove: (deviceId: DeviceId) => Effect.Effect<void>
  /** The connection of a device, when it is in the pool. */
  readonly get: (deviceId: DeviceId) => Effect.Effect<O.Option<DeviceConnectionShape>>
  /** A snapshot of every device in the pool. */
  readonly status: Effect.Effect<ReadonlyArray<DeviceStatus>>
}

/**
 * A device's place in the pool. The slot is taken before the fiber starts, so
 * two concurrent `add` calls for one identifier cannot both win; `connection`
 * fills in once the connection is supervised.
 */
interface Slot {
  readonly started: Deferred.Deferred<DeviceConnectionShape>
  readonly connection: O.Option<DeviceConnectionShape>
}

const make = Effect.fnUntraced(function* () {
  const transport = yield* Transport
  const fibers = yield* FiberMap.make<DeviceId>()
  const slots = yield* Ref.make(HashMap.empty<DeviceId, Slot>())

  const add = (config: DeviceConfig): Effect.Effect<DeviceConnectionShape, DeviceAlreadyAdded> =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<DeviceConnectionShape>()
      // Claiming the slot and noticing a duplicate are one atomic step: doing
      // them apart lets two adds for the same device both pass the check.
      const claimed = yield* Ref.modify(slots, (current) =>
        HashMap.has(current, config.id)
          ? [false, current]
          : [true, HashMap.set(current, config.id, { started, connection: O.none() })])

      if (!claimed) {
        return yield* Effect.fail(new DeviceAlreadyAdded({ deviceId: config.id }))
      }

      yield* FiberMap.run(
        fibers,
        config.id,
        Effect.scoped(
          Effect.gen(function* () {
            const connection = yield* Effect.provideService(makeDeviceConnection(config), Transport, transport)
            yield* Ref.update(slots, (current) =>
              HashMap.set(current, config.id, { started, connection: O.some(connection) }))
            yield* Effect.addFinalizer(() => Ref.update(slots, (current) => HashMap.remove(current, config.id)))
            yield* Deferred.succeed(started, connection)
            // Hold the scope open until the device is removed or the pool closes.
            return yield* Effect.never
          })
        ).pipe(
          Effect.catchCause((cause) =>
            pipe(
              Ref.update(slots, (current) => HashMap.remove(current, config.id)),
              Effect.andThen(
                Effect.logError("a device connection stopped", cause).pipe(
                  Effect.annotateLogs({ deviceId: config.id })
                )
              )
            )
          )
        )
      )
      return yield* Deferred.await(started)
    })

  const remove = (deviceId: DeviceId): Effect.Effect<void> => FiberMap.remove(fibers, deviceId)

  const get = (deviceId: DeviceId): Effect.Effect<O.Option<DeviceConnectionShape>> =>
    Effect.map(Ref.get(slots), (current) => O.flatMap(HashMap.get(current, deviceId), (slot) => slot.connection))

  const status = Effect.flatMap(Ref.get(slots), (current) =>
    Effect.forEach(
      A.getSomes(A.map(A.fromIterable(HashMap.values(current)), (slot) => slot.connection)),
      (connection) =>
        Effect.all({
          deviceId: Effect.succeed(connection.deviceId),
          state: SubscriptionRef.get(connection.state),
          delivered: connection.delivered,
          duplicates: connection.duplicates
        })
    ))

  return { add, remove, get, status } satisfies DevicePoolShape
})

/**
 * Many controllers supervised together.
 *
 * The pool is a service: provide `DevicePool.layer` over a `Transport` and the
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
 *   const pool = yield* DevicePool
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
export class DevicePool extends Context.Service<DevicePool, DevicePoolShape>()(
  "effect-open-protocol/DevicePool"
) {
  /**
   * Provides a pool that supervises its devices for the lifetime of the layer.
   *
   * @since 0.0.0
   */
  static readonly layer: Layer.Layer<DevicePool, never, Transport> = Layer.effect(DevicePool)(make())
}
