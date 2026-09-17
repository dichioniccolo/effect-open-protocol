/**
 * The real transport: plain TCP to a controller.
 *
 * This is the only module that knows about sockets. It adapts the Effect
 * `Socket` service to the library's `Duplex`, mapping socket failures onto the
 * two states the rest of the code cares about: the connection could not be
 * opened, or it went away.
 *
 * @since 0.0.0
 */
import { NodeSocket } from "@effect/platform-node"
import { Effect, Layer, pipe, Stream } from "effect"
import { ConnectionFailed, ConnectionLost, type Duplex, type Endpoint, Transport } from "./Transport.ts"

const toBytes = (chunk: Uint8Array | string): Uint8Array =>
  typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk

/**
 * Opens TCP connections with `@effect/platform-node`.
 *
 * **Example** (Running the library against real controllers)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { TcpTransport } from "effect-open-protocol"
 *
 * const program = Effect.void.pipe(Effect.provide(TcpTransport.layer))
 * ```
 *
 * @category layers
 * @since 0.0.0
 */
export const layer: Layer.Layer<Transport> = Layer.succeed(Transport)({
  connect: Effect.fnUntraced(function* (endpoint: Endpoint) {
    const socket = yield* pipe(
      NodeSocket.makeNet({ host: endpoint.host, port: endpoint.port }),
      Effect.mapError((error) => new ConnectionFailed({ endpoint, reason: `${error}` }))
    )
    const reader = yield* pipe(
      socket.reader,
      Effect.mapError((error) => new ConnectionFailed({ endpoint, reason: `${error}` }))
    )
    const writer = yield* socket.writer

    const incoming: Stream.Stream<Uint8Array, ConnectionLost> = pipe(
      Stream.fromPull(Effect.succeed(reader.pull)),
      Stream.map(toBytes),
      Stream.mapError((error) => new ConnectionLost({ reason: `${error}` }))
    )

    return {
      incoming,
      send: (bytes: Uint8Array) =>
        pipe(
          writer.write(bytes),
          Effect.mapError((error) => new ConnectionLost({ reason: `${error}` }))
        )
    } satisfies Duplex
  })
})
