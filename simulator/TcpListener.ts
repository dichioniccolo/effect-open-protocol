/**
 * The TCP port a simulated controller listens on, and the ability to lose it.
 *
 * A listening socket cannot stop accepting while it stays open, so refusing
 * connections means actually tearing the listener down: the server closes, the
 * sessions it was holding go with it, and the port is free. Rebinding brings
 * it back. That is what a controller reboot looks like from the client's side,
 * `ECONNREFUSED` included, and it is the only way the `refuseConnections`
 * fault means anything over real sockets.
 *
 * Accepted connections are handed over as `ServerSide`, optionally wrapped by
 * `decorate`, which is how the CLI traces and delays the bytes a controller
 * writes.
 *
 * @since 0.0.0
 */
import { NodeSocketServer } from "@effect/platform-node"
import { Deferred, Effect, Fiber, pipe, Queue, Ref, Stream } from "effect"
import * as A from "effect/Array"
import * as O from "effect/Option"
import * as S from "effect/Schema"
import type { ServerSide } from "../src/transport/InMemoryTransport.ts"
import { ConnectionLost, type Endpoint } from "../src/transport/Transport.ts"

/**
 * The simulated controller could not take its TCP port.
 *
 * @category errors
 * @since 0.0.0
 */
export class SimulatorListenFailed extends S.TaggedError<SimulatorListenFailed>()("SimulatorListenFailed", {
  endpoint: S.String,
  reason: S.String
}) {}

/** Capacity of the accept queue, matching the in-memory network. */
const capacity = 64

const encoder = new TextEncoder()

/**
 * A bound TCP port that can be dropped and taken again.
 *
 * @category models
 * @since 0.0.0
 */
export interface TcpListener {
  /** Connections accepted since the last take. */
  readonly accept: Queue.Dequeue<ServerSide>
  /**
   * Drops the listener and every session it holds, or takes the port again.
   * Calling it twice the same way is a no-op.
   */
  readonly refuse: (refused: boolean) => Effect.Effect<void>
}

/**
 * Binds a TCP port for the lifetime of the calling scope.
 *
 * **Example** (Serving a simulated controller on a port)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { Endpoint } from "effect-open-protocol"
 * import { makeTcpListener } from "../simulator/TcpListener.ts"
 *
 * const program = Effect.gen(function* () {
 *   const listener = yield* makeTcpListener({
 *     endpoint: new Endpoint({ host: "127.0.0.1", port: 45455 })
 *   })
 *   return yield* listener.refuse(true)
 * })
 * ```
 *
 * @category constructors
 * @since 0.0.0
 */
export const makeTcpListener = Effect.fnUntraced(function* (options: {
  readonly endpoint: Endpoint
  /** Wraps every accepted connection before it is handed to the simulator. */
  readonly decorate?: ((side: ServerSide) => Effect.Effect<ServerSide>) | undefined
}) {
  const address = `${options.endpoint.host}:${options.endpoint.port}`
  const accepted = yield* Queue.bounded<ServerSide>(capacity)
  const running = yield* Ref.make(O.none<Fiber.Fiber<never, SimulatorListenFailed>>())
  // Set once the owning scope closes, so a late outage window cannot bring the
  // port back up while the simulator is shutting down.
  const retired = yield* Ref.make(false)

  const handOver = (side: ServerSide): Effect.Effect<void> =>
    pipe(
      O.match(O.fromNullishOr(options.decorate), {
        onNone: () => Effect.succeed(side),
        onSome: (decorate) => decorate(side)
      }),
      Effect.flatMap((ready) => Queue.offer(accepted, ready)),
      Effect.asVoid
    )

  /**
   * One binding: the server, the sockets it accepted, and the loop that
   * accepts them. Interrupting this effect closes all three, because Node
   * keeps a listening server alive until its sockets are gone.
   */
  const binding = (ready: Deferred.Deferred<void, SimulatorListenFailed>) =>
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* Effect.mapError(
          NodeSocketServer.make({ host: options.endpoint.host, port: options.endpoint.port }),
          (error) => new SimulatorListenFailed({ endpoint: address, reason: `${error}` })
        )
        const openSockets = yield* Ref.make<ReadonlyArray<Deferred.Deferred<void>>>([])
        yield* Effect.addFinalizer(() =>
          pipe(
            Ref.getAndSet(openSockets, []),
            Effect.flatMap((pending) =>
              Effect.forEach(pending, (closed) => Deferred.succeed(closed, undefined), { discard: true })
            )
          )
        )
        yield* Deferred.succeed(ready, undefined)
        return yield* Effect.mapError(
          server.run((socket) =>
            Effect.gen(function* () {
              const reader = yield* socket.reader
              const writer = yield* socket.writer
              const closed = yield* Deferred.make<void>()
              yield* Ref.update(openSockets, (current) => A.append(current, closed))
              const side: ServerSide = {
                incoming: pipe(
                  Stream.fromPull(Effect.succeed(reader.pull)),
                  Stream.map((chunk) => (typeof chunk === "string" ? encoder.encode(chunk) : chunk)),
                  Stream.mapError((error) => new ConnectionLost({ reason: `${error}` }))
                ),
                send: (bytes) =>
                  Effect.mapError(writer.write(bytes), (error) => new ConnectionLost({ reason: `${error}` })),
                close: () => Effect.asVoid(Deferred.succeed(closed, undefined))
              }
              yield* handOver(side)
              return yield* Deferred.await(closed)
            }).pipe(
              Effect.scoped,
              Effect.catchCause((cause) => Effect.logDebug("simulator socket ended", cause))
            )
          ),
          (error) => new SimulatorListenFailed({ endpoint: address, reason: `${error}` })
        )
      })
    )

  const bind: Effect.Effect<void, SimulatorListenFailed> = Effect.gen(function* () {
    const done = yield* Ref.get(retired)
    const current = yield* Ref.get(running)
    return yield* done
      ? Effect.void
      : O.match(current, {
          onSome: () => Effect.void,
          onNone: () =>
            Effect.gen(function* () {
              const ready = yield* Deferred.make<void, SimulatorListenFailed>()
              const fiber = yield* Effect.forkChild(
                pipe(
                  binding(ready),
                  Effect.tapError((error) => Deferred.fail(ready, error))
                )
              )
              // Fails here, not in the background, when the port is taken.
              yield* Deferred.await(ready)
              yield* Ref.set(running, O.some(fiber))
            })
        })
  })

  const unbind: Effect.Effect<void> = pipe(
    Ref.getAndSet(running, O.none()),
    Effect.flatMap(
      O.match({
        onNone: () => Effect.void,
        onSome: (fiber) => Effect.asVoid(Fiber.interrupt(fiber))
      })
    )
  )

  yield* bind
  yield* Effect.addFinalizer(() => Effect.andThen(Ref.set(retired, true), unbind))

  const refuse = (refused: boolean): Effect.Effect<void> =>
    refused
      ? pipe(
          unbind,
          Effect.andThen(
            Effect.logInfo("the controller stopped listening").pipe(Effect.annotateLogs({ endpoint: address }))
          )
        )
      : pipe(
          bind,
          Effect.tap(() =>
            Effect.logInfo("the controller is listening again").pipe(Effect.annotateLogs({ endpoint: address }))
          ),
          // A port that is still in TIME_WAIT leaves the controller dark rather
          // than killing the run; the next outage window tries again.
          Effect.catchTag("SimulatorListenFailed", (error) =>
            Effect.logWarning("the controller could not take its port back").pipe(
              Effect.annotateLogs({ endpoint: address, reason: error.reason })
            )
          )
        )

  return { accept: accepted, refuse } satisfies TcpListener
})
