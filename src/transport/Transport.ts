/**
 * The byte-level boundary of the library.
 *
 * Everything above this service speaks frames and messages; only transport
 * implementations know about sockets. Tests provide an in-memory transport,
 * the demo provides TCP, and neither changes a line of connection logic.
 *
 * @since 0.0.0
 */
import { Context, type Effect, type Scope, type Stream } from "effect"
import * as S from "effect/Schema"

/**
 * Where a controller listens.
 *
 * @category models
 * @since 0.0.0
 */
export class Endpoint extends S.Class<Endpoint>("Endpoint")(
  {
    host: S.String.check(S.isMinLength(1)),
    port: S.Number.check(S.isInt(), S.isBetween({ minimum: 1, maximum: 65535 }))
  },
  { description: "Host and port of a controller" }
) {}

/**
 * A connection could not be opened.
 *
 * @category errors
 * @since 0.0.0
 */
export class ConnectionFailed extends S.TaggedError<ConnectionFailed>()("ConnectionFailed", {
  endpoint: Endpoint,
  reason: S.String
}) {}

/**
 * An established connection went away, cleanly or not.
 *
 * @category errors
 * @since 0.0.0
 */
export class ConnectionLost extends S.TaggedError<ConnectionLost>()("ConnectionLost", {
  reason: S.String
}) {}

/**
 * A live bidirectional byte channel.
 *
 * `incoming` ends (or fails with `ConnectionLost`) when the peer goes away;
 * `send` applies the transport's backpressure before succeeding.
 *
 * @category models
 * @since 0.0.0
 */
export interface Duplex {
  readonly incoming: Stream.Stream<Uint8Array, ConnectionLost>
  readonly send: (bytes: Uint8Array) => Effect.Effect<void, ConnectionLost>
}

/**
 * Opens byte channels to controllers.
 *
 * The returned `Duplex` belongs to the caller's `Scope`: closing the scope
 * releases the socket and every fiber the transport started.
 *
 * @category services
 * @since 0.0.0
 */
export class Transport extends Context.Service<
  Transport,
  {
    readonly connect: (endpoint: Endpoint) => Effect.Effect<Duplex, ConnectionFailed, Scope.Scope>
  }
>()("effect-open-protocol/Transport") {}
