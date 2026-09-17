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
import { Deferred, Effect, FiberMap, Layer, MutableHashMap, SubscriptionRef } from "effect"
import * as A from "effect/Array"
import * as O from "effect/Option"
import * as Context from "effect/Context"
import * as S from "effect/Schema"
import type { ConnectionState } from "../connection/ConnectionState.ts"
import {
  type DeviceConfig,
  type DeviceConnectionShape,
  make as makeConnection
} from "../connection/DeviceConnection.ts"
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

const make = Effect.fnUntraced(function* () {
  const transport = yield* Transport
  const fibers = yield* FiberMap.make<DeviceId>()
  const connections = MutableHashMap.empty<DeviceId, DeviceConnectionShape>()

  const add = (config: DeviceConfig): Effect.Effect<DeviceConnectionShape, DeviceAlreadyAdded> =>
    O.isSome(MutableHashMap.get(connections, config.id))
      ? Effect.fail(new DeviceAlreadyAdded({ deviceId: config.id }))
      : Effect.gen(function* () {
        const started = yield* Deferred.make<DeviceConnectionShape>()
        yield* FiberMap.run(
          fibers,
          config.id,
          Effect.scoped(
            Effect.gen(function* () {
              const connection = yield* Effect.provideService(makeConnection(config), Transport, transport)
              MutableHashMap.set(connections, config.id, connection)
              yield* Effect.addFinalizer(() =>
                Effect.sync(() => MutableHashMap.remove(connections, config.id))
              )
              yield* Deferred.succeed(started, connection)
              // Hold the scope open until the device is removed or the pool closes.
              return yield* Effect.never
            })
          ).pipe(
            Effect.catchCause((cause) =>
              Effect.logError("a device connection stopped", cause).pipe(
                Effect.annotateLogs({ deviceId: config.id })
              )
            )
          )
        )
        return yield* Deferred.await(started)
      })

  const remove = (deviceId: DeviceId): Effect.Effect<void> => FiberMap.remove(fibers, deviceId)

  const get = (deviceId: DeviceId): Effect.Effect<O.Option<DeviceConnectionShape>> =>
    Effect.sync(() => MutableHashMap.get(connections, deviceId))

  const status = Effect.suspend(() =>
    Effect.forEach(
      A.fromIterable(MutableHashMap.values(connections)),
      (connection) =>
        Effect.all({
          deviceId: Effect.succeed(connection.deviceId),
          state: SubscriptionRef.get(connection.state),
          delivered: connection.delivered,
          duplicates: connection.duplicates
        })
    )
  )

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
