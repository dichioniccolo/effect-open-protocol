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
import { InMemoryNetwork, layerComplete, type ServerSide } from "../src/transport/InMemoryTransport.ts"
import type { Endpoint, Transport } from "../src/transport/Transport.ts"
import type { SimulatorListenFailed } from "./TcpListener.ts"

/**
 * What a simulated controller needs from the network it listens on.
 *
 * @category models
 * @since 0.0.0
 */
export interface SimulatorNetworkService {
  /** Accepts connections on an endpoint until the caller's scope closes. */
  readonly bind: (endpoint: Endpoint) => Effect.Effect<Queue.Dequeue<ServerSide>, SimulatorListenFailed, Scope.Scope>
  /** Stops accepting on an endpoint, the way a rebooting controller does, or starts again. */
  readonly refuse: (endpoint: Endpoint, refused: boolean) => Effect.Effect<void>
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
  Effect.map(InMemoryNetwork, (network) => ({ bind: network.bind, refuse: network.refuse }))
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
