/**
 * Typed failures a device connection can report to the application.
 *
 * @since 0.0.0
 */
import * as S from "effect/Schema"

/**
 * The handshake was refused by the controller, with the Open Protocol error
 * code it returned (96 means another client already holds the connection).
 *
 * @category errors
 * @since 0.0.0
 */
export class HandshakeRejected extends S.TaggedError<HandshakeRejected>()("HandshakeRejected", {
  code: S.Number.check(S.isInt(), S.isBetween({ minimum: 0, maximum: 99 }))
}) {}

/**
 * The controller rejected a command with its Open Protocol error code.
 *
 * @category errors
 * @since 0.0.0
 */
export class CommandRejected extends S.TaggedError<CommandRejected>()("CommandRejected", {
  mid: S.Number.check(S.isInt(), S.isBetween({ minimum: 0, maximum: 9999 })),
  code: S.Number.check(S.isInt(), S.isBetween({ minimum: 0, maximum: 99 }))
}) {}

/**
 * No reply arrived within the configured response timeout.
 *
 * @category errors
 * @since 0.0.0
 */
export class RequestTimeout extends S.TaggedError<RequestTimeout>()("RequestTimeout", {
  mid: S.Number.check(S.isInt(), S.isBetween({ minimum: 0, maximum: 9999 }))
}) {}

/**
 * A request was made while the connection was not ready to carry it.
 *
 * @category errors
 * @since 0.0.0
 */
export class NotReady extends S.TaggedError<NotReady>()("NotReady", {
  state: S.String
}) {}

/**
 * A subscription to this data MID is already active on the connection: the
 * controller pushes each MID once, so it has one consumer at a time.
 *
 * **Example** (Telling a second consumer apart)
 *
 * ```ts
 * import { Effect, Stream } from "effect"
 * import { DeviceConnection, LastResults } from "effect-open-protocol"
 *
 * const second = Effect.gen(function* () {
 *   const connection = yield* DeviceConnection.DeviceConnection
 *
 *   yield* Stream.runDrain(connection.subscribe(LastResults.rev(1))).pipe(
 *     Effect.catchTag("AlreadySubscribed", (error) => Effect.log(`MID ${error.mid} already has a consumer`))
 *   )
 * })
 * ```
 *
 * @category errors
 * @since 0.0.0
 */
export class AlreadySubscribed extends S.TaggedError<AlreadySubscribed>()("AlreadySubscribed", {
  mid: S.Number.check(S.isInt(), S.isBetween({ minimum: 0, maximum: 9999 }))
}) {}
