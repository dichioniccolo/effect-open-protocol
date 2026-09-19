/**
 * Fixed-width Open Protocol fields as Effect Schemas.
 *
 * Every data field on the wire is a fixed number of ASCII characters, optionally
 * preceded by a two-digit parameter id. Each constructor here returns a
 * `Field`: a real `Schema` between exactly that string and a typed value, next
 * to its width and parameter id. `layout` strings an ordered list of them into
 * the codec of a whole data field.
 *
 * @since 0.0.0
 */
import { Data, Effect, Predicate, Result } from "effect"
import * as A from "effect/Array"
import * as O from "effect/Option"
import * as R from "effect/Record"
import * as S from "effect/Schema"
import type { ParseOptions } from "effect/SchemaAST"
import * as SchemaIssue from "effect/SchemaIssue"
import * as SchemaTransformation from "effect/SchemaTransformation"
import * as Str from "effect/String"
import { isDigits, padNumber, padText } from "./Ascii.ts"

/**
 * Where a field sits on the wire: its width, and its parameter id when the
 * layout carries ids.
 *
 * @category models
 * @since 0.0.0
 */
export interface FieldPlacement {
  readonly width: number
  readonly id: O.Option<string>
}

/**
 * A field: its codec (exactly `width` characters on the wire, a typed value
 * in memory) and where it sits.
 *
 * **Example** (Decoding one field on its own)
 *
 * ```ts
 * import * as S from "effect/Schema"
 * import { Field } from "effect-open-protocol"
 *
 * const cellId = Field.digits({ width: 4 })
 *
 * const decoded = S.decodeEffect(cellId.codec)("0042")
 * ```
 *
 * @category models
 * @since 0.0.0
 */
export class Field<T> extends Data.TaggedClass("Field")<{
  readonly codec: S.Codec<T, string>
  readonly placement: FieldPlacement
}> {}

/**
 * A filler: written on the wire, checked on decode, never in the decoded
 * value.
 *
 * **Example** (A reserved two-digit parameter)
 *
 * ```ts
 * import { Field } from "effect-open-protocol"
 *
 * console.log(Field.filler({ id: "05", width: 2 }).value) // "00"
 * ```
 *
 * @category models
 * @since 0.0.0
 */
export class Filler extends Data.TaggedClass("Filler")<{
  readonly placement: FieldPlacement
  readonly value: string
}> {}

/**
 * Where a field goes, shared by every constructor.
 *
 * @category models
 * @since 0.0.0
 */
export interface Placement {
  /** Number of characters the value occupies, id excluded. */
  readonly width: number
  /** Two-digit parameter id written before the value, when the layout uses ids. */
  readonly id?: string | undefined
}

const invalid = (message: string, input: string, options: ParseOptions): Effect.Effect<never, SchemaIssue.Issue> =>
  Effect.fail(new SchemaIssue.InvalidValue({ message }, input, options))

const placementOf = (placement: Placement): FieldPlacement => ({
  width: placement.width,
  id: O.fromNullishOr(placement.id)
})

const place = <T>(codec: S.Codec<T, string>, placement: Placement): Field<T> =>
  new Field({ codec, placement: placementOf(placement) })

const exactly = (width: number) =>
  S.String.check(
    S.makeFilter((value: string) => Str.length(value) === width, {
      identifier: `FixedWidth${width}`,
      title: `${width} characters`,
      description: `an Open Protocol field of exactly ${width} characters`
    })
  )

const digitsFor = (width: number) =>
  S.Int.check(S.isBetween({ minimum: 0, maximum: 10 ** width - 1 })).annotate({
    identifier: `Digits${width}`,
    description: `a non-negative integer that fits in ${width} ASCII digits`
  })

/**
 * A number written as left-padded ASCII digits.
 *
 * **Details**
 *
 * Decoding rejects anything but digits; encoding rejects a value too wide for
 * the field instead of writing a frame of the wrong length. Pass `schema` to
 * decode into a refined or branded number, such as `TighteningId`.
 *
 * **Example** (A four-digit cell id with parameter id 01)
 *
 * ```ts
 * import { Field } from "effect-open-protocol"
 *
 * const cellId = Field.digits({ id: "01", width: 4 })
 * ```
 *
 * @category constructors
 * @since 0.0.0
 */
export function digits(placement: Placement): Field<number>
export function digits<T extends number>(placement: Placement & { readonly schema: S.Codec<T, number> }): Field<T>
export function digits(placement: Placement & { readonly schema?: S.Codec<number, number> }): Field<number> {
  const target = placement.schema ?? digitsFor(placement.width)

  const fits = (text: string): boolean => Str.length(text) === placement.width && isDigits(text)

  const codec = S.String.pipe(
    S.decodeTo(
      target,
      SchemaTransformation.transformEffect({
        decode: (text: string, options) =>
          fits(text)
            ? Effect.succeed(Number(text))
            : invalid(`expected ${placement.width} digits, found "${text}"`, text, options),
        encode: (value: number, options) =>
          Effect.gen(function* () {
            const text = padNumber(value, placement.width)

            return fits(text)
              ? text
              : yield* invalid(`${value} does not fit in ${placement.width} digits`, text, options)
          })
      })
    )
  )

  return place(codec, placement)
}

/**
 * Text written right-padded with spaces; decoding drops the padding.
 *
 * **Example** (A 25-character controller name)
 *
 * ```ts
 * import { Field } from "effect-open-protocol"
 *
 * const controllerName = Field.text({ id: "03", width: 25 })
 * ```
 *
 * @category constructors
 * @since 0.0.0
 */
export const text = (placement: Placement): Field<string> => {
  const codec = exactly(placement.width).pipe(
    S.decodeTo(
      S.String,
      SchemaTransformation.transformEffect({
        decode: (padded: string) => Effect.succeed(Str.trimEnd(padded)),
        encode: (value: string, options) =>
          Str.length(value) > placement.width
            ? invalid(`"${value}" is longer than ${placement.width} characters`, value, options)
            : Effect.succeed(padText(value, placement.width))
      })
    )
  )

  return place(codec, placement)
}

/**
 * Characters kept exactly as written, for values with their own fixed format
 * such as timestamps. Pass `schema` to decode into a refined string.
 *
 * **Example** (A controller timestamp)
 *
 * ```ts
 * import { ControllerTimestamp, Field } from "effect-open-protocol"
 *
 * const timestamp = Field.raw({ id: "20", width: 19, schema: ControllerTimestamp })
 * ```
 *
 * @category constructors
 * @since 0.0.0
 */
export function raw(placement: Placement): Field<string>
export function raw<T extends string>(placement: Placement & { readonly schema: S.Codec<T, string> }): Field<T>
export function raw(placement: Placement & { readonly schema?: S.Codec<string, string> }): Field<string> {
  const codec = exactly(placement.width).pipe(
    S.decodeTo(placement.schema ?? S.String, SchemaTransformation.passthrough())
  )

  return place(codec, placement)
}

/**
 * A literal written as the digit of its position in `literals`, the way the
 * protocol encodes statuses (`0` = first literal, `1` = second, ...).
 *
 * **Example** (A tightening status, 0 = NOK and 1 = OK)
 *
 * ```ts
 * import { Field, TighteningStatus } from "effect-open-protocol"
 *
 * const status = Field.enumerated({ id: "09", width: 1, literals: TighteningStatus })
 * ```
 *
 * @category constructors
 * @since 0.0.0
 */
export const enumerated = <const L extends ReadonlyArray<string>>(
  placement: Placement & { readonly literals: S.Literals<L> }
): Field<L[number]> => {
  const { literals } = placement.literals

  const literalOf = (code: string): O.Option<L[number]> =>
    O.gen(function* () {
      const digitsText = yield* O.liftPredicate(code, isDigits)

      return yield* A.get(literals, Number(digitsText))
    })

  const codeOf = (literal: L[number]): O.Option<string> =>
    O.gen(function* () {
      const index = yield* A.findFirstIndex(literals, (candidate) => candidate === literal)

      return yield* O.liftPredicate(padNumber(index, placement.width), (code) => Str.length(code) === placement.width)
    })

  const codec = S.String.pipe(
    S.decodeTo(
      placement.literals,
      SchemaTransformation.transformEffect({
        decode: (code: string, options) =>
          O.match(literalOf(code), {
            onNone: () => invalid(`"${code}" is not one of ${A.length(literals)} codes`, code, options),
            onSome: Effect.succeed
          }),
        encode: (literal: L[number], options) =>
          O.match(codeOf(literal), {
            onNone: () => invalid(`"${literal}" has no code of ${placement.width} digits`, literal, options),
            onSome: Effect.succeed
          })
      })
    )
  )

  return place(codec, placement)
}

/**
 * A field the layout carries but the value does not: decoding skips it,
 * encoding writes `value` (zeros when omitted).
 *
 * **Example** (A reserved four-digit parameter)
 *
 * ```ts
 * import { Field } from "effect-open-protocol"
 *
 * const reserved = Field.filler({ id: "07", width: 4 })
 * ```
 *
 * @category constructors
 * @since 0.0.0
 */
export const filler = (placement: Placement & { readonly value?: string | undefined }): Filler =>
  new Filler({
    placement: placementOf(placement),
    value: O.getOrElse(O.fromNullishOr(placement.value), () => padNumber(0, placement.width))
  })

/**
 * One entry of a layout: a named field that ends up in the decoded value, or a
 * bare filler that does not.
 *
 * @category models
 * @since 0.0.0
 */
export type Entry = readonly [name: string, field: Field<unknown>] | Filler

/**
 * The struct fields a layout decodes into, one per named entry.
 *
 * @category models
 * @since 0.0.0
 */
export type Fields<Entries extends ReadonlyArray<Entry>> = {
  readonly [
    E in Entries[number] as E extends readonly [infer Name extends string, Field<unknown>] ? Name : never
  ]: E extends readonly [string, Field<infer T>] ? S.Codec<T, string> : never
}

/**
 * The codec of a whole data field: the entries in wire order, as one string.
 *
 * @category models
 * @since 0.0.0
 */
export interface Layout<Entries extends ReadonlyArray<Entry>> extends S.decodeTo<S.Struct<Fields<Entries>>, S.String> {}

const placed = (entry: Entry): FieldPlacement =>
  Predicate.isTagged(entry, "Filler") ? entry.placement : entry[1].placement

interface Scan {
  readonly offset: number
  readonly values: ReadonlyArray<readonly [string, string]>
}

const step =
  (data: string, options: ParseOptions) =>
  (scan: Scan, entry: Entry): Effect.Effect<Scan, SchemaIssue.Issue> => {
    const placement = placed(entry)
    const expected = O.getOrElse(placement.id, () => "")
    const id = Str.substring(scan.offset, scan.offset + Str.length(expected))(data)
    const start = scan.offset + Str.length(expected)
    const value = Str.substring(start, start + placement.width)(data)

    if (id !== expected) {
      return invalid(`expected parameter ${expected} at offset ${scan.offset}, found "${id}"`, data, options)
    }

    if (Str.length(value) !== placement.width) {
      return invalid(`parameter ${expected || `at offset ${start}`} is truncated`, data, options)
    }

    return Effect.succeed({
      offset: start + placement.width,
      values: Predicate.isTagged(entry, "Filler") ? scan.values : A.append(scan.values, [entry[0], value] as const)
    })
  }

const emptyScan: Scan = { offset: 0, values: [] }

const slice = (
  entries: ReadonlyArray<Entry>,
  data: string,
  options: ParseOptions
): Effect.Effect<{ readonly [name: string]: string }, SchemaIssue.Issue> =>
  Effect.gen(function* () {
    const scan = yield* Effect.reduce(entries, () => emptyScan, step(data, options))

    return R.fromEntries(scan.values)
  })

const written = (entry: Entry, values: { readonly [name: string]: string }): string =>
  Predicate.isTagged(entry, "Filler") ? entry.value : O.getOrElse(R.get(values, entry[0]), () => "")

const join = (entries: ReadonlyArray<Entry>, values: { readonly [name: string]: string }): string =>
  A.join(
    A.map(entries, (entry) => O.getOrElse(placed(entry).id, () => "") + written(entry, values)),
    ""
  )

/**
 * Strings entries into the codec of a whole data field.
 *
 * **Details**
 *
 * Entries are an array, so wire order never depends on object key order. A
 * `[name, field]` pair becomes a property of the decoded value; a bare filler
 * is written on encode and checked (id and width) on decode, and never
 * surfaces. Characters after the last entry are ignored.
 *
 * **Example** (The MID 0002 revision 1 data field)
 *
 * ```ts
 * import { Field } from "effect-open-protocol"
 *
 * const accepted = Field.layout([
 *   ["cellId", Field.digits({ id: "01", width: 4 })],
 *   ["channelId", Field.digits({ id: "02", width: 2 })],
 *   ["controllerName", Field.text({ id: "03", width: 25 })]
 * ])
 * ```
 *
 * @category constructors
 * @since 0.0.0
 */
export function layout<const Entries extends ReadonlyArray<Entry>>(entries: Entries): Layout<Entries>
export function layout(entries: ReadonlyArray<Entry>): S.Top {
  const named = A.filterMap(entries, (entry) =>
    Predicate.isTagged(entry, "Filler") ? Result.failVoid : Result.succeed([entry[0], entry[1].codec] as const)
  )

  return S.String.pipe(
    S.decodeTo(
      S.Struct(R.fromEntries(named)),
      SchemaTransformation.transformEffect({
        decode: (data: string, options) => slice(entries, data, options),
        encode: (values: { readonly [name: string]: string }) => Effect.succeed(join(entries, values))
      })
    )
  )
}
