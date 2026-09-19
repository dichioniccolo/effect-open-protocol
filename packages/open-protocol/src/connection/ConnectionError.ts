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
 * The reply a request waits for arrived at a revision the request did not
 * declare, so it cannot be read as the promised type.
 *
 * **Example** (A controller answering 0065 at revision 2)
 *
 * ```ts
 * import { UnexpectedRevision } from "effect-open-protocol"
 *
 * const error = new UnexpectedRevision({ mid: 65, expected: 1, received: 2 })
 * ```
 *
 * @category errors
 * @since 0.0.0
 */
export class UnexpectedRevision extends S.TaggedError<UnexpectedRevision>()("UnexpectedRevision", {
  mid: S.Number.check(S.isInt(), S.isBetween({ minimum: 0, maximum: 9999 })),
  expected: S.Number.check(S.isInt(), S.isBetween({ minimum: 1, maximum: 999 })),
  received: S.Number.check(S.isInt(), S.isBetween({ minimum: 1, maximum: 999 }))
}) {}
