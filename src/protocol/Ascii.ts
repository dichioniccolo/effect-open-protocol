/**
 * The ASCII conventions every Open Protocol field shares.
 *
 * The protocol has exactly one way of writing a number (left-padded ASCII
 * digits of a fixed width) and one way of writing text (right-padded, fixed
 * width). Header fields, generic acknowledgements and result parameters all
 * follow it, so the parsing and rendering live here once and each caller only
 * supplies the error it wants to raise.
 *
 * @since 0.0.0
 */
import { pipe, Result } from "effect"
import * as A from "effect/Array"
import * as S from "effect/Schema"
import * as Str from "effect/String"

const decodeNumber = S.decodeResult(S.NumberFromString)

/**
 * Whether a string is a non-empty run of ASCII digits.
 *
 * **Example** (Recognising a padded field)
 *
 * ```ts
 * import { isDigits } from "effect-open-protocol"
 *
 * console.log(isDigits("0060"))
 * ```
 *
 * @category predicates
 * @since 0.0.0
 */
export const isDigits = (value: string): boolean =>
  Str.isNonEmpty(value) && A.every([...value], (char) => char >= "0" && char <= "9")

/**
 * Reads a run of ASCII digits as a number, raising the caller's error when the
 * field holds anything else.
 *
 * **Example** (Decoding a length field)
 *
 * ```ts
 * import { Result } from "effect"
 * import { parseDigits } from "effect-open-protocol"
 *
 * const length = parseDigits("0020", () => "not a length" as const)
 *
 * console.log(Result.isSuccess(length))
 * ```
 *
 * @category decoding
 * @since 0.0.0
 */
export const parseDigits = <E>(raw: string, onError: () => E): Result.Result<number, E> =>
  isDigits(raw)
    ? pipe(decodeNumber(raw), Result.mapError(onError))
    : Result.fail(onError())

/**
 * Renders a number as `width` ASCII digits, left-padded with zeroes.
 *
 * **Example** (Rendering a MID)
 *
 * ```ts
 * import { padNumber } from "effect-open-protocol"
 *
 * console.log(padNumber(60, 4))
 * ```
 *
 * @category encoding
 * @since 0.0.0
 */
export const padNumber = (value: number, width: number): string =>
  pipe(`${Math.round(value)}`, Str.padStart(width, "0"))

/**
 * Renders text as exactly `width` characters, truncated or padded with spaces.
 *
 * **Example** (Rendering a VIN)
 *
 * ```ts
 * import { padText } from "effect-open-protocol"
 *
 * console.log(padText("VIN1", 6))
 * ```
 *
 * @category encoding
 * @since 0.0.0
 */
export const padText = (value: string, width: number): string =>
  pipe(Str.substring(0, width)(value), (text) => text + Str.repeat(width - Str.length(text))(" "))
