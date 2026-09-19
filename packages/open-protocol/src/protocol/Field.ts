/**
 * Fixed-width Open Protocol fields as Effect Schemas.
 *
 * Every data field on the wire is a fixed number of ASCII characters, optionally
 * preceded by a two-digit parameter id. Each constructor here returns a real
 * `Schema` between exactly that string and a typed value, annotated with its
 * width and parameter id. `layout` strings an ordered list of them into the
 * codec of a whole data field.
 *
 * @since 0.0.0
 */
import { Effect, pipe } from "effect"
import * as A from "effect/Array"
import * as O from "effect/Option"
import * as R from "effect/Record"
import * as S from "effect/Schema"
import type { ParseOptions } from "effect/SchemaAST"
import * as SchemaIssue from "effect/SchemaIssue"
import * as SchemaTransformation from "effect/SchemaTransformation"
import * as Str from "effect/String"
import { isDigits, padNumber, padText } from "./Ascii.ts"

declare module "effect/Schema" {
  // oxlint-disable-next-line no-shadow -- augmentation must reopen Effect's own namespace
  namespace Annotations {
    interface Annotations {
      /** Where a field sits on the wire; read by {@link layout}. */
      readonly openProtocolField?: FieldPlacement | undefined
    }
  }
}

/**
 * How a field is placed on the wire: its width, its parameter id when the
 * layout carries ids, and the characters a filler field always writes.
 *
 * @category models
 * @since 0.0.0
 */
export interface FieldPlacement {
  readonly width: number
  readonly id: O.Option<string>
  readonly filler: O.Option<string>
}

/**
 * A field's codec: exactly `width` characters on the wire, a typed value in
 * memory.
 *
 * @category models
 * @since 0.0.0
 */
export interface Field<T> extends S.Codec<T, string> {}

/**
 * A filler: on the wire, never in the decoded value.
 *
 * @category models
 * @since 0.0.0
 */
export interface Filler extends S.Codec<string, string> {}

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

const place =
  (placement: Placement, filler: O.Option<string>) =>
  <C extends S.Top>(codec: C) =>
    codec.annotate({
      openProtocolField: { width: placement.width, id: O.fromNullishOr(placement.id), filler }
    })

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

  return pipe(
    S.String,
    S.decodeTo(
      target,
      SchemaTransformation.transformEffect({
        decode: (raw: string, options) =>
          Str.length(raw) === placement.width && isDigits(raw)
            ? Effect.succeed(Number(raw))
            : invalid(`expected ${placement.width} digits, found "${raw}"`, raw, options),
        encode: (value: number, options) =>
          pipe(padNumber(value, placement.width), (raw) =>
            Str.length(raw) === placement.width && isDigits(raw)
              ? Effect.succeed(raw)
              : invalid(`${value} does not fit in ${placement.width} digits`, raw, options)
          )
      })
    ),
    place(placement, O.none())
  )
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
export const text = (placement: Placement): Field<string> =>
  pipe(
    exactly(placement.width),
    S.decodeTo(
      S.String,
      SchemaTransformation.transformEffect({
        decode: (raw: string) => Effect.succeed(Str.trimEnd(raw)),
        encode: (value: string, options) =>
          Str.length(value) > placement.width
            ? invalid(`"${value}" is longer than ${placement.width} characters`, value, options)
            : Effect.succeed(padText(value, placement.width))
      })
    ),
    place(placement, O.none())
  )

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
  return pipe(
    exactly(placement.width),
    S.decodeTo(placement.schema ?? S.String, SchemaTransformation.passthrough()),
    place(placement, O.none())
  )
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
): Field<L[number]> =>
  pipe(
    S.String,
    S.decodeTo(
      placement.literals,
      SchemaTransformation.transformEffect({
        decode: (code: string, options) =>
          pipe(
            O.liftPredicate(code, isDigits),
            O.flatMap((digitsText) => A.get(placement.literals.literals, Number(digitsText))),
            O.match({
              onNone: () =>
                invalid(`"${code}" is not one of ${A.length(placement.literals.literals)} codes`, code, options),
              onSome: (literal) => Effect.succeed(literal)
            })
          ),
        encode: (literal: L[number], options) =>
          pipe(
            A.findFirstIndex(placement.literals.literals, (candidate) => candidate === literal),
            O.map((index) => padNumber(index, placement.width)),
            O.filter((rawText) => Str.length(rawText) === placement.width),
            O.match({
              onNone: () => invalid(`"${literal}" has no code of ${placement.width} digits`, literal, options),
              onSome: (rawText) => Effect.succeed(rawText)
            })
          )
      })
    ),
    place(placement, O.none())
  )

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
  place(
    placement,
    O.some(O.getOrElse(O.fromNullishOr(placement.value), () => padNumber(0, placement.width)))
  )(exactly(placement.width))

/**
 * One entry of a layout: a named field that ends up in the decoded value, or a
 * bare filler that does not.
 *
 * @category models
 * @since 0.0.0
 */
export type Entry = readonly [name: string, field: S.Codec<unknown, string, unknown, unknown>] | Filler

/**
 * The struct fields a layout decodes into, one per named entry.
 *
 * @category models
 * @since 0.0.0
 */
export type Fields<Entries extends ReadonlyArray<Entry>> = {
  readonly [
    E in Entries[number] as E extends readonly [infer Name extends string, S.Top] ? Name : never
  ]: E extends readonly [string, infer Codec extends S.Top] ? Codec : never
}

/**
 * The codec of a whole data field: the entries in wire order, as one string.
 *
 * @category models
 * @since 0.0.0
 */
export interface Layout<Entries extends ReadonlyArray<Entry>> extends S.decodeTo<S.Struct<Fields<Entries>>, S.String> {}

interface Slot {
  readonly name: O.Option<string>
  readonly placement: FieldPlacement
}

const placementOf = (codec: S.Top): FieldPlacement =>
  O.getOrElse(O.fromNullishOr(S.resolveAnnotations(codec)?.openProtocolField), () => ({
    width: 0,
    id: O.none(),
    filler: O.none()
  }))

const slotOf = (entry: Entry): Slot =>
  S.isSchema(entry)
    ? { name: O.none(), placement: placementOf(entry) }
    : { name: O.some(entry[0]), placement: placementOf(entry[1]) }

interface Scan {
  readonly offset: number
  readonly values: ReadonlyArray<readonly [string, string]>
}

const step =
  (data: string, options: ParseOptions) =>
  (scan: Scan, slot: Slot): Effect.Effect<Scan, SchemaIssue.Issue> => {
    const idWidth = O.match(slot.placement.id, { onNone: () => 0, onSome: Str.length })
    const id = Str.substring(scan.offset, scan.offset + idWidth)(data)
    const start = scan.offset + idWidth
    const value = Str.substring(start, start + slot.placement.width)(data)
    const expected = O.getOrElse(slot.placement.id, () => "")

    return id !== expected
      ? invalid(`expected parameter ${expected} at offset ${scan.offset}, found "${id}"`, data, options)
      : Str.length(value) !== slot.placement.width
        ? invalid(`parameter ${expected || `at offset ${start}`} is truncated`, data, options)
        : Effect.succeed({
            offset: start + slot.placement.width,
            values: O.match(slot.name, {
              onNone: () => scan.values,
              onSome: (name) => A.append(scan.values, [name, value] as const)
            })
          })
  }

const emptyScan: Scan = { offset: 0, values: [] }

const slice = (
  slots: ReadonlyArray<Slot>,
  data: string,
  options: ParseOptions
): Effect.Effect<{ readonly [name: string]: string }, SchemaIssue.Issue> =>
  Effect.map(
    A.reduce(slots, Effect.succeed(emptyScan), (scanned: Effect.Effect<Scan, SchemaIssue.Issue>, slot) =>
      Effect.flatMap(scanned, (scan) => step(data, options)(scan, slot))
    ),
    (scan) => R.fromEntries(scan.values)
  )

const join = (slots: ReadonlyArray<Slot>, values: { readonly [name: string]: string }): string =>
  A.join(
    A.map(
      slots,
      (slot) =>
        O.getOrElse(slot.placement.id, () => "") +
        O.getOrElse(
          O.orElse(slot.placement.filler, () => O.flatMap(slot.name, (name) => O.fromNullishOr(values[name]))),
          () => ""
        )
    ),
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
  const slots = A.map(entries, slotOf)

  const named = A.getSomes(
    A.map(entries, (entry): O.Option<readonly [string, S.Codec<unknown, string, unknown, unknown>]> =>
      S.isSchema(entry) ? O.none() : O.some(entry)
    )
  )

  return pipe(
    S.String,
    S.decodeTo(
      S.Struct(R.fromEntries(named)),
      SchemaTransformation.transformEffect({
        decode: (data: string, options) => slice(slots, data, options),
        encode: (values: { readonly [name: string]: string }) => Effect.succeed(join(slots, values))
      })
    )
  )
}
