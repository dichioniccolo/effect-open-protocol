/**
 * Where a simulated controller takes its connections from.
 *
 * The simulator does not care whether its clients arrive over real sockets or
 * through the in-process network, just as the library does not care which
 * `Transport` it dials through. Both sides pick their network from context, so
 * a test, the demo and the CLI choose it once, at the composition root.
 *
 * @since 0.0.0
 */
import { Context, Effect, Layer, type Queue, type Scope } from "effect"
import * as S from "effect/Schema"
import { InMemoryNetwork, layerComplete, type ServerSide } from "../src/transport/InMemoryTransport.ts"
import type { Endpoint, Transport } from "../src/transport/Transport.ts"

/**
 * The simulated controller could not take its port.
 *
 * @category errors
 * @since 0.0.0
 */
export class SimulatorListenFailed extends S.TaggedError<SimulatorListenFailed>()("SimulatorListenFailed", {
  endpoint: S.String,
  reason: S.String
}) {}

/**
 * One bound endpoint, as the simulated controller behind it sees it.
 *
 * @category models
 * @since 0.0.0
 */
export interface Listener {
  /** Connections accepted on the endpoint. */
  readonly accepted: Queue.Dequeue<ServerSide>
  /** Stops accepting, the way a rebooting controller does, or starts again. */
  readonly refuse: (refused: boolean) => Effect.Effect<void>
}

/**
 * What a simulated controller needs from the network it listens on.
 *
 * @category models
 * @since 0.0.0
 */
export interface SimulatorNetworkService {
  /** Listens on an endpoint until the caller's scope closes. */
  readonly bind: (endpoint: Endpoint) => Effect.Effect<Listener, SimulatorListenFailed, Scope.Scope>
}

/**
 * The network simulated controllers listen on.
 *
 * `layerInMemory` binds on the `InMemoryNetwork`; the TCP
 * layer lives next to the listener in `TcpListener`.
 *
 * @category services
 * @since 0.0.0
 */
export class SimulatorNetwork extends Context.Service<SimulatorNetwork, SimulatorNetworkService>()(
  "effect-open-protocol/SimulatorNetwork"
) {}

/**
 * Listens on the in-process network, next to the in-memory transport.
 *
 * @category layers
 * @since 0.0.0
 */
export const layerInMemory: Layer.Layer<SimulatorNetwork, never, InMemoryNetwork> = Layer.effect(SimulatorNetwork)(
  Effect.map(InMemoryNetwork, (network) => ({
    bind: (endpoint) =>
      Effect.map(network.bind(endpoint), (accepted) => ({
        accepted,
        refuse: (refused) => network.refuse(endpoint, refused)
      }))
  }))
)

/**
 * The in-memory transport, its network, and simulators listening on it: all a
 * test needs to run a client against a simulated controller in-process.
 *
 * @category layers
 * @since 0.0.0
 */
export const layerSimulated: Layer.Layer<Transport | InMemoryNetwork | SimulatorNetwork> = Layer.provideMerge(
  layerInMemory,
  layerComplete
)
