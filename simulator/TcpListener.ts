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
import { Deferred, Effect, Fiber, Layer, pipe, Predicate, Queue, Ref, Stream } from "effect"
import * as A from "effect/Array"
import * as O from "effect/Option"
import type { ServerSide } from "../src/transport/InMemoryTransport.ts"
import { ConnectionLost, type Endpoint } from "../src/transport/Transport.ts"
import { type Listener, SimulatorListenFailed, SimulatorNetwork } from "./SimulatorNetwork.ts"

/** Capacity of the accept queue, matching the in-memory network. */
const capacity = 64

const encoder = new TextEncoder()

/** Binds a TCP port for the lifetime of the calling scope. */
const listen = Effect.fnUntraced(function* (options: {
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

  const handOver = Effect.fnUntraced(function* (side: ServerSide) {
    const decorate = O.fromNullishOr(options.decorate)
    const ready = O.isNone(decorate) ? side : yield* decorate.value(side)

    yield* Queue.offer(accepted, ready)
  })

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
        yield* Effect.addFinalizer(
          Effect.fnUntraced(function* () {
            const pending = yield* Ref.getAndSet(openSockets, [])

            yield* Effect.forEach(pending, (closed) => Deferred.succeed(closed, undefined), { discard: true })
          })
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
                  Stream.map((chunk) => (Predicate.isString(chunk) ? encoder.encode(chunk) : chunk)),
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

    if (done || O.isSome(current)) {
      return
    }

    const ready = yield* Deferred.make<void, SimulatorListenFailed>()

    const fiber = yield* Effect.forkChild(binding(ready).pipe(Effect.tapError((error) => Deferred.fail(ready, error))))

    // Fails here, not in the background, when the port is taken.
    yield* Deferred.await(ready)
    yield* Ref.set(running, O.some(fiber))
  })

  const unbind: Effect.Effect<void> = Effect.gen(function* () {
    const fiber = yield* Ref.getAndSet(running, O.none())

    if (O.isSome(fiber)) {
      yield* Fiber.interrupt(fiber.value)
    }
  })

  yield* bind
  yield* Effect.addFinalizer(
    Effect.fnUntraced(function* () {
      yield* Ref.set(retired, true)
      yield* unbind
    })
  )

  const refuse = Effect.fnUntraced(function* (refused: boolean) {
    if (refused) {
      yield* unbind
      yield* Effect.logInfo("the controller stopped listening").pipe(Effect.annotateLogs({ endpoint: address }))

      return
    }

    yield* bind.pipe(
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
  })

  return { accepted, refuse } satisfies Listener
})

/**
 * Simulated controllers listening on real TCP ports.
 *
 * Each `bind` takes its own port for the caller's scope, so any number of
 * simulators can share the layer. `decorate` wraps every accepted connection,
 * which is how the CLI traces and delays the bytes a controller writes.
 *
 * **Example** (Serving a simulated controller on a port)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { Endpoint } from "effect-open-protocol"
 * import { make } from "../simulator/ControllerSimulator.ts"
 * import { layer } from "../simulator/TcpListener.ts"
 *
 * const program = make({ endpoint: new Endpoint({ host: "127.0.0.1", port: 45455 }) }).pipe(
 *   Effect.provide(layer()),
 *   Effect.scoped
 * )
 * ```
 *
 * @category layers
 * @since 0.0.0
 */
export const layer = (
  options: { readonly decorate?: ((side: ServerSide) => Effect.Effect<ServerSide>) | undefined } = {}
): Layer.Layer<SimulatorNetwork> =>
  Layer.succeed(SimulatorNetwork)({ bind: (endpoint) => listen({ endpoint, decorate: options.decorate }) })
