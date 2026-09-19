/**
 * Typed errors raised by the Open Protocol codec.
 *
 * @since 0.0.0
 */
import * as S from "effect/Schema"

/**
 * A header field did not hold the ASCII digits (or padding) the protocol
 * requires.
 *
 * **Example** (Reporting a bad length field)
 *
 * ```ts
 * import { MalformedHeader } from "effect-open-protocol"
 *
 * const error = new MalformedHeader({ field: "length", value: "00x0" })
 * ```
 *
 * @category errors
 * @since 0.0.0
 */
export class MalformedHeader extends S.TaggedError<MalformedHeader>()("MalformedHeader", {
  field: S.String,
  value: S.String
}) {}

/**
 * The header length field is outside the range a frame can occupy.
 *
 * @category errors
 * @since 0.0.0
 */
export class InvalidLength extends S.TaggedError<InvalidLength>()("InvalidLength", {
  length: S.Number
}) {}

/**
 * The byte following the announced message length was not the NUL terminator.
 *
 * @category errors
 * @since 0.0.0
 */
export class MissingTerminator extends S.TaggedError<MissingTerminator>()("MissingTerminator", {
  length: S.Number
}) {}

/**
 * The peer used a protocol feature this library deliberately does not support,
 * such as link-level sequence numbering or message linking.
 *
 * @category errors
 * @since 0.0.0
 */
export class UnsupportedFeature extends S.TaggedError<UnsupportedFeature>()("UnsupportedFeature", {
  feature: S.String,
  value: S.String
}) {}

/**
 * The data field of a supported MID did not match its documented layout.
 *
 * @category errors
 * @since 0.0.0
 */
export class PayloadDecodeError extends S.TaggedError<PayloadDecodeError>()("PayloadDecodeError", {
  mid: S.Number,
  reason: S.String
}) {}

/**
 * A value could not be written as a frame: a field does not fit its width, or
 * the value is not one its revision's schema accepts.
 *
 * **Example** (An out-of-range value)
 *
 * ```ts
 * import { PayloadEncodeError } from "effect-open-protocol"
 *
 * const error = new PayloadEncodeError({ mid: 2, reason: "12345 does not fit in 4 digits" })
 * ```
 *
 * @category errors
 * @since 0.0.0
 */
export class PayloadEncodeError extends S.TaggedError<PayloadEncodeError>()("PayloadEncodeError", {
  mid: S.Number,
  reason: S.String
}) {}

/**
 * A reply arrived at a revision its request did not declare, so it cannot be
 * read as the promised type.
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

/**
 * What can break the framing of a byte stream.
 *
 * @category errors
 * @since 0.0.0
 */
export type FramingError = InvalidLength | MalformedHeader | MissingTerminator

/**
 * Every failure the codec can produce.
 *
 * @category errors
 * @since 0.0.0
 */
export type ProtocolError =
  | MalformedHeader
  | InvalidLength
  | MissingTerminator
  | UnsupportedFeature
  | PayloadDecodeError
