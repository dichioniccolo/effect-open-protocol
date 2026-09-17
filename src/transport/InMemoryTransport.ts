/**
 * An in-process transport used by tests and by the simulator.
 *
 * `InMemoryNetwork` plays the role of the network: simulated controllers bind
 * an endpoint, clients connect to it, and each connection is a pair of bounded
 * queues. No sockets, no timers, no real waiting — which is what makes the
 * connection tests deterministic under `TestClock`.
 *
 * @since 0.0.0
 */
import { Context, Effect, Layer, MutableHashMap, Queue, Scope, Stream } from "effect"
import * as O from "effect/Option"
import { ConnectionFailed, ConnectionLost, type Duplex, Endpoint, Transport } from "./Transport.ts"

const key = (endpoint: Endpoint): string => `${endpoint.host}:${endpoint.port}`

/** Capacity of each direction of an in-memory connection. */
const capacity = 64

const pipeOf = (
  queue: Queue.Queue<Uint8Array, ConnectionLost>
): { readonly incoming: Stream.Stream<Uint8Array, ConnectionLost>; readonly send: Duplex["send"] } => ({
  incoming: Stream.fromQueue(queue),
  send: (bytes) => Effect.orDie(Queue.offer(queue, bytes))
})

/**
 * One end of an in-memory connection, as seen by a simulated controller.
 *
 * @category models
 * @since 0.0.0
 */
export interface ServerSide extends Duplex {
  readonly close: (reason: string) => Effect.Effect<void>
}

/**
 * An in-process stand-in for the network.
 *
 * @category services
 * @since 0.0.0
 */
export class InMemoryNetwork extends Context.Service<InMemoryNetwork, {
  /** Accepts connections on an endpoint until the caller's scope closes. */
  readonly bind: (endpoint: Endpoint) => Effect.Effect<Queue.Dequeue<ServerSide>, never, Scope.Scope>
  /** Opens a connection, failing when nothing is bound to the endpoint. */
  readonly connect: (endpoint: Endpoint) => Effect.Effect<Duplex, ConnectionFailed, Scope.Scope>
  /** Stops accepting new connections without touching the established ones. */
  readonly refuse: (endpoint: Endpoint, refused: boolean) => Effect.Effect<void>
}>()("effect-open-protocol/InMemoryNetwork") {}

interface Listener {
  readonly accepted: Queue.Queue<ServerSide>
  readonly refused: boolean
}

const make = Effect.gen(function* () {
  const listeners = MutableHashMap.empty<string, Listener>()

  const bind = Effect.fnUntraced(function* (endpoint: Endpoint) {
    const accepted = yield* Queue.bounded<ServerSide>(capacity)
    MutableHashMap.set(listeners, key(endpoint), { accepted, refused: false })
    yield* Effect.addFinalizer(() => Effect.sync(() => MutableHashMap.remove(listeners, key(endpoint))))
    return accepted as Queue.Dequeue<ServerSide>
  })

  const refuse = (endpoint: Endpoint, refused: boolean): Effect.Effect<void> =>
    Effect.sync(() =>
      MutableHashMap.modify(listeners, key(endpoint), (listener) => ({ accepted: listener.accepted, refused }))
    )

  const connect = Effect.fnUntraced(function* (endpoint: Endpoint) {
    const open = yield* O.match(MutableHashMap.get(listeners, key(endpoint)), {
      onNone: () =>
        Effect.fail(new ConnectionFailed({ endpoint, reason: "nothing is listening on this endpoint" })),
      onSome: (found) =>
        found.refused
          ? Effect.fail(new ConnectionFailed({ endpoint, reason: "connection refused" }))
          : Effect.succeed(found)
    })
    const toClient = yield* Queue.bounded<Uint8Array, ConnectionLost>(capacity)
    const toServer = yield* Queue.bounded<Uint8Array, ConnectionLost>(capacity)
    const closeBoth = (reason: string): Effect.Effect<void> =>
      Effect.all([
        Queue.fail(toClient, new ConnectionLost({ reason })),
        Queue.fail(toServer, new ConnectionLost({ reason }))
      ], { discard: true })
    const serverSide: ServerSide = {
      incoming: pipeOf(toServer).incoming,
      send: pipeOf(toClient).send,
      close: closeBoth
    }
    yield* Queue.offer(open.accepted, serverSide)
    yield* Effect.addFinalizer(() => closeBoth("client closed the connection"))
    return {
      incoming: pipeOf(toClient).incoming,
      send: pipeOf(toServer).send
    } satisfies Duplex
  })

  return { bind, connect, refuse } as const
})

/**
 * Provides an isolated in-process network.
 *
 * @category layers
 * @since 0.0.0
 */
export const layerNetwork: Layer.Layer<InMemoryNetwork> = Layer.effect(InMemoryNetwork)(make)

/**
 * Provides a `Transport` backed by an `InMemoryNetwork`.
 *
 * **Example** (Wiring tests against simulated controllers)
 *
 * ```ts
 * import { Layer } from "effect"
 * import { InMemoryTransport } from "effect-open-protocol"
 *
 * const testTransport = InMemoryTransport.layer.pipe(
 *   Layer.provideMerge(InMemoryTransport.layerNetwork)
 * )
 * ```
 *
 * @category layers
 * @since 0.0.0
 */
export const layer: Layer.Layer<Transport, never, InMemoryNetwork> = Layer.effect(Transport)(
  Effect.map(InMemoryNetwork, (network) => ({ connect: network.connect }))
)
