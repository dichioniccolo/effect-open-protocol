/**
 * The 20-byte Open Protocol message header: its schema, decoder and encoder.
 *
 * Field layout (Open Protocol specification §2.2.2): length 4, MID 4,
 * revision 3, no-ack flag 1, station id 2, spindle id 2, sequence number 2,
 * number of message parts 1, message part number 1. Numeric fields are ASCII
 * digits padded on the left with `0`; blank fields fall back to their default.
 *
 * @since 0.0.0
 */
import { pipe, Result } from "effect"
import * as S from "effect/Schema"
import * as Str from "effect/String"
import { padNumber, parseDigits } from "./Ascii.ts"
import { MalformedHeader, UnsupportedFeature } from "./ProtocolError.ts"

/**
 * Length in bytes of every Open Protocol header.
 *
 * @category constants
 * @since 0.0.0
 */
export const headerLength = 20

/**
 * The NUL byte terminating an Open Protocol message.
 *
 * @category constants
 * @since 0.0.0
 */
export const terminator = "\u0000"

const field = (raw: string, name: string): Result.Result<number, MalformedHeader> =>
  parseDigits(Str.trim(raw), () => new MalformedHeader({ field: name, value: raw }))

const fieldOrDefault = (raw: string, name: string, fallback: number): Result.Result<number, MalformedHeader> =>
  Str.isEmpty(Str.trim(raw)) ? Result.succeed(fallback) : field(raw, name)

const reserved = (raw: string, feature: string): Result.Result<void, MalformedHeader | UnsupportedFeature> =>
  pipe(
    fieldOrDefault(raw, feature, 0),
    Result.flatMap((value) =>
      value === 0 ? Result.succeed(undefined) : Result.fail(new UnsupportedFeature({ feature, value: raw }))
    )
  )

/**
 * A MID number: four ASCII digits on the wire.
 *
 * @category models
 * @since 0.0.0
 */
export const MidNumber = S.Number.check(S.isInt(), S.isBetween({ minimum: 0, maximum: 9999 })).annotate({
  identifier: "MidNumber",
  description: "An Open Protocol message id, written as four ASCII digits"
})

/**
 * @category models
 * @since 0.0.0
 */
export type MidNumber = typeof MidNumber.Type

/**
 * A revision number: three ASCII digits on the wire, starting at 1.
 *
 * @category models
 * @since 0.0.0
 */
export const RevisionNumber = S.Number.check(S.isInt(), S.isBetween({ minimum: 1, maximum: 999 })).annotate({
  identifier: "RevisionNumber",
  description: "An Open Protocol message revision, written as three ASCII digits"
})

/**
 * @category models
 * @since 0.0.0
 */
export type RevisionNumber = typeof RevisionNumber.Type

/**
 * A decoded Open Protocol header.
 *
 * Unsupported header features (link-level sequence numbers, message linking)
 * never reach this type: the decoder rejects them with `UnsupportedFeature`.
 *
 * **Example** (Building a communication start header)
 *
 * ```ts
 * import { Header } from "effect-open-protocol"
 *
 * const header = new Header({
 *   length: 20,
 *   mid: 1,
 *   revision: 1,
 *   noAck: false,
 *   stationId: 1,
 *   spindleId: 1
 * })
 * ```
 *
 * @category models
 * @since 0.0.0
 */
export class Header extends S.Class<Header>("Header")(
  {
    length: S.Number.check(S.isInt(), S.isBetween({ minimum: headerLength, maximum: 9999 })),
    mid: MidNumber,
    revision: RevisionNumber,
    noAck: S.Boolean,
    stationId: S.Number.check(S.isInt(), S.isBetween({ minimum: 1, maximum: 99 })),
    spindleId: S.Number.check(S.isInt(), S.isBetween({ minimum: 1, maximum: 99 }))
  },
  { description: "The 20 byte header carried by every Open Protocol message" }
) {}

/**
 * Decodes the 20 leading characters of a message into a `Header`.
 *
 * A blank revision, station id or spindle id means 1; a blank no-ack flag
 * means "acknowledge" (reliable mode). Sequence numbering and message linking
 * fail with `UnsupportedFeature`.
 *
 * **Example** (Decoding a keep-alive header)
 *
 * ```ts
 * import { Result } from "effect"
 * import { decodeHeader } from "effect-open-protocol"
 *
 * const decoded = decodeHeader("00209999            ")
 *
 * console.log(Result.isSuccess(decoded))
 * ```
 *
 * @category decoding
 * @since 0.0.0
 */
export const decodeHeader = (text: string): Result.Result<Header, MalformedHeader | UnsupportedFeature> =>
  Str.length(text) < headerLength
    ? Result.fail(new MalformedHeader({ field: "header", value: text }))
    : Result.gen(function* () {
        const length = yield* field(Str.substring(0, 4)(text), "length")
        const mid = yield* field(Str.substring(4, 8)(text), "mid")
        const revision = yield* fieldOrDefault(Str.substring(8, 11)(text), "revision", 1)
        const noAck = yield* fieldOrDefault(Str.substring(11, 12)(text), "noAck", 0)
        const stationId = yield* fieldOrDefault(Str.substring(12, 14)(text), "stationId", 1)
        const spindleId = yield* fieldOrDefault(Str.substring(14, 16)(text), "spindleId", 1)
        yield* reserved(Str.substring(16, 18)(text), "sequenceNumber")
        yield* reserved(Str.substring(18, 19)(text), "messageParts")
        yield* reserved(Str.substring(19, 20)(text), "messagePartNumber")

        return new Header({
          length,
          mid,
          revision: revision === 0 ? 1 : revision,
          noAck: noAck === 1,
          stationId: stationId === 0 ? 1 : stationId,
          spindleId: spindleId === 0 ? 1 : spindleId
        })
      })

/**
 * Renders a header as the 20 ASCII characters that open a message.
 *
 * **Example** (Encoding a keep-alive header)
 *
 * ```ts
 * import { encodeHeader, Header } from "effect-open-protocol"
 *
 * const text = encodeHeader(
 *   new Header({
 *     length: 20,
 *     mid: 9999,
 *     revision: 1,
 *     noAck: false,
 *     stationId: 1,
 *     spindleId: 1
 *   })
 * )
 * ```
 *
 * @category encoding
 * @since 0.0.0
 */
export const encodeHeader = (header: Header): string =>
  padNumber(header.length, 4) +
  padNumber(header.mid, 4) +
  padNumber(header.revision, 3) +
  (header.noAck ? "1" : "0") +
  padNumber(header.stationId, 2) +
  padNumber(header.spindleId, 2) +
  "00" +
  "0" +
  "0"

/**
 * Wraps a data field in a complete frame: a reliable-mode header for `mid` at
 * `revision`, its length computed from `data`, and the NUL terminator.
 *
 * **Example** (A keep-alive frame)
 *
 * ```ts
 * import { encodeFrame } from "effect-open-protocol"
 *
 * console.log(encodeFrame(9999, 1, "")) // "00209999001000000000\u0000"
 * ```
 *
 * @category encoding
 * @since 0.0.0
 */
export const encodeFrame = (mid: number, revision: number, data: string): string =>
  encodeHeader(
    new Header({
      length: headerLength + Str.length(data),
      mid,
      revision,
      noAck: false,
      stationId: 1,
      spindleId: 1
    })
  ) +
  data +
  terminator
