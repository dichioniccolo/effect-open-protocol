/**
 * Rendering raw Open Protocol bytes as text a terminal survives.
 *
 * A frame is latin1, ends in a NUL terminator, and pads its fields to fixed
 * widths with spaces. Printing it unescaped hides the padding and can put a
 * terminal into a state the reader did not ask for, so every byte outside the
 * printable ASCII range is written as an escape and nothing else is touched.
 *
 * The two directions are exact inverses, which is what makes a trace evidence
 * rather than decoration: `unescapeWire(escapeWire(bytes))` returns the same
 * bytes for every possible input.
 *
 * @since 0.0.0
 */
import { Match, pipe } from "effect"
import * as A from "effect/Array"
import * as O from "effect/Option"
import * as Str from "effect/String"

const decoder = new TextDecoder("latin1")

const hexDigits = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d", "e", "f"] as const

const digitAt = (index: number): string =>
  pipe(
    A.get(hexDigits, index),
    O.getOrElse(() => "0")
  )

/** Every byte value, as the latin1 character it decodes to. */
const characters: ReadonlyArray<string> = pipe(
  A.range(0, 255),
  (values) => Uint8Array.from(values),
  (bytes) => decoder.decode(bytes),
  (text) => A.map(A.range(0, 255), (code) => Str.substring(code, code + 1)(text))
)

const characterOf = (code: number): string =>
  pipe(
    A.get(characters, code),
    O.getOrElse(() => "?")
  )

const named: ReadonlyArray<readonly [number, string]> = [
  [0, "\\0"],
  [9, "\\t"],
  [10, "\\n"],
  [13, "\\r"],
  [92, "\\\\"]
]

const isPrintable = (code: number): boolean => code >= 32 && code <= 126

/** How one byte is written. Computed once, because a trace renders a lot of them. */
const tokens: ReadonlyArray<string> = A.map(A.range(0, 255), (code) =>
  pipe(
    A.findFirst(named, ([value]) => value === code),
    O.map(([, token]) => token),
    O.getOrElse(() =>
      isPrintable(code) ? characterOf(code) : `\\x${digitAt(Math.floor(code / 16))}${digitAt(code % 16)}`
    )
  )
)

const tokenOf = (code: number): string =>
  pipe(
    A.get(tokens, code),
    O.getOrElse(() => "\\x00")
  )

/** The byte each single printable character stands for, for the way back. */
const codes: ReadonlyMap<string, number> = new Map(A.map(A.range(0, 255), (code) => [characterOf(code), code] as const))

const namedCodes: ReadonlyMap<string, number> = new Map(
  A.map(named, ([code, token]) => [Str.substring(1, 2)(token), code] as const)
)

const hexValues: ReadonlyMap<string, number> = new Map(
  A.map(A.range(0, 15), (value) => [digitAt(value), value] as const)
)

const lookup = (table: ReadonlyMap<string, number>, key: string): O.Option<number> => O.fromNullishOr(table.get(key))

/**
 * Renders bytes as printable text, escaping everything a terminal should not
 * receive raw.
 *
 * NUL becomes `\0`, tab, newline and carriage return take their usual escapes,
 * a backslash doubles, and every other non-printable byte becomes `\xNN`.
 * Spaces are left alone, so field padding stays countable.
 *
 * **Example** (Rendering a keep-alive frame)
 *
 * ```ts
 * import { escapeWire } from "effect-open-protocol"
 *
 * const frame = new TextEncoder().encode("00209999            \u0000")
 *
 * console.log(escapeWire(frame))
 * ```
 *
 * @category encoding
 * @since 0.0.0
 */
export const escapeWire = (bytes: Uint8Array): string =>
  pipe(A.map(A.fromIterable(bytes), tokenOf), (rendered) => A.join(rendered, ""))

/** One escape sequence, and how many characters of input it consumed. */
interface Token {
  readonly code: number
  readonly width: number
}

const escaped = (text: string, at: number): O.Option<Token> =>
  pipe(Str.substring(at + 1, at + 2)(text), (marker) =>
    Match.value(marker).pipe(
      Match.when("x", () =>
        pipe(
          O.all([
            lookup(hexValues, Str.substring(at + 2, at + 3)(text)),
            lookup(hexValues, Str.substring(at + 3, at + 4)(text))
          ]),
          O.map(([high, low]) => ({ code: high * 16 + low, width: 4 }))
        )
      ),
      Match.orElse(() => O.map(lookup(namedCodes, marker), (code) => ({ code, width: 2 })))
    )
  )

const plain = (text: string, at: number): O.Option<Token> =>
  O.map(lookup(codes, Str.substring(at, at + 1)(text)), (code) => ({ code, width: 1 }))

/**
 * Reads escaped text back into the exact bytes it was rendered from.
 *
 * A sequence that is not a recognised escape is dropped rather than guessed
 * at, so this never invents a byte the wire did not carry.
 *
 * **Example** (Round-tripping a frame)
 *
 * ```ts
 * import { escapeWire, unescapeWire } from "effect-open-protocol"
 *
 * const bytes = new TextEncoder().encode("0020\u0000")
 *
 * console.log(unescapeWire(escapeWire(bytes)).length === bytes.length)
 * ```
 *
 * @category decoding
 * @since 0.0.0
 */
export const unescapeWire = (text: string): Uint8Array => {
  const read = (at: number, collected: ReadonlyArray<number>): ReadonlyArray<number> =>
    at >= Str.length(text)
      ? collected
      : pipe(
          Str.substring(at, at + 1)(text) === "\\" ? escaped(text, at) : plain(text, at),
          O.match({
            onNone: () => read(at + 1, collected),
            onSome: (token) => read(at + token.width, A.append(collected, token.code))
          })
        )
  return Uint8Array.from(read(0, []))
}
