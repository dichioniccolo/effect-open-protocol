/**
 * Open Protocol messages defined as data: a MID number, one Schema per
 * revision, and for requests, the reply each revision expects.
 *
 * A definition is written once, in code, and everything else is derived from
 * it: the exact type of each revision, the frame codec, and the type of the
 * reply `DeviceConnection.request` returns. The library's own messages are
 * defined the same way (see `Messages.ts`), so a user-defined MID is not a
 * second-class citizen.
 *
 * @since 0.0.0
 */
import { Data, Effect, pipe, Predicate, Result } from "effect"
import * as A from "effect/Array"
import * as Context from "effect/Context"
import * as O from "effect/Option"
import * as R from "effect/Record"
import * as S from "effect/Schema"
import * as SchemaTransformation from "effect/SchemaTransformation"
import * as Str from "effect/String"
import { encodeHeader, Header, headerLength, terminator } from "./Header.ts"
import { PayloadDecodeError, PayloadEncodeError } from "./ProtocolError.ts"
import type { DeviceId } from "./TighteningResult.ts"

/**
 * What decoding a frame may need beyond the frame itself.
 *
 * **Details**
 *
 * The device a frame came from never travels on the wire, yet a tightening
 * result carries it. A revision codec that needs it reads this service; the
 * codec entry points provide it.
 *
 * @category services
 * @since 0.0.0
 */
export class FrameContext extends Context.Service<FrameContext, { readonly deviceId: DeviceId }>()(
  "effect-open-protocol/FrameContext"
) {}

/**
 * A revision whose value is a class: the layout decodes into the class's
 * fields, the definition adds `_tag` and `revision`.
 *
 * @category models
 * @since 0.0.0
 */
export class Binding<Target extends S.Top, Layout extends S.Top> extends Data.TaggedClass("Binding")<{
  readonly target: Target
  readonly layout: Layout
}> {}

/**
 * A revision written as a ready codec, for values whose shape differs from the
 * wire record. The codec must produce `_tag` and `revision` itself.
 *
 * @category models
 * @since 0.0.0
 */
export class Custom<Codec extends S.Top> extends Data.TaggedClass("Custom")<{
  readonly codec: Codec
}> {}

/**
 * Decodes a layout into instances of `target`.
 *
 * **Example** (A class-valued revision)
 *
 * ```ts
 * import * as S from "effect/Schema"
 * import { Field, Mid } from "effect-open-protocol"
 *
 * class JobSelected extends S.TaggedClass<JobSelected>()("JobSelected", {
 *   revision: S.tag(1),
 *   jobId: S.Number
 * }) {}
 *
 * const revision = Mid.as(JobSelected, Field.layout([["jobId", Field.digits({ width: 4 })]]))
 * ```
 *
 * @category constructors
 * @since 0.0.0
 */
export const as = <Target extends S.Top, Layout extends S.Top>(
  target: Target,
  layout: Layout
): Binding<Target, Layout> => new Binding({ target, layout })

/**
 * Uses a ready codec as a revision.
 *
 * **Example** (Wrapping an existing codec)
 *
 * ```ts
 * import * as S from "effect/Schema"
 * import { Mid } from "effect-open-protocol"
 *
 * declare const codec: S.Codec<{ readonly _tag: "Raw"; readonly revision: 1; readonly body: string }, string>
 *
 * const revision = Mid.custom(codec)
 * ```
 *
 * @category constructors
 * @since 0.0.0
 */
export const custom = <Codec extends S.Top>(codec: Codec): Custom<Codec> => new Custom({ codec })

/**
 * One revision of a definition, as written: a `Field.layout` (decoded into a
 * plain tagged struct), `as(Class, layout)`, or `custom(codec)`.
 *
 * @category models
 * @since 0.0.0
 */
export type Entry = LayoutEntry | Binding<S.Top, S.Top> | Custom<S.Top>

/**
 * A `Field.layout`: a string decoded into a struct of fields.
 *
 * @category models
 * @since 0.0.0
 */
export interface LayoutEntry extends S.decodeTo<S.Struct<S.Struct.Fields>, S.Top> {}

type TypeFields<Fields extends S.Struct.Fields> = { readonly [K in keyof Fields]: S.toType<Fields[K]> }

/**
 * The codec a definition builds from one entry.
 *
 * @category models
 * @since 0.0.0
 */
export type CodecOf<Tag extends string, Number extends number, E> =
  E extends Binding<infer Target, infer Layout>
    ? S.decodeTo<Target, Layout>
    : E extends Custom<infer Codec>
      ? Codec
      : E extends S.decodeTo<S.Struct<infer Fields>, infer From>
        ? S.decodeTo<
            S.Struct<{ readonly _tag: S.tag<Tag>; readonly revision: S.tag<Number> } & TypeFields<Fields>>,
            S.decodeTo<S.Struct<Fields>, From>
          >
        : never

/**
 * The revisions of a definition, keyed by revision number.
 *
 * @category models
 * @since 0.0.0
 */
export type Entries = { readonly [revision: number]: Entry }

/**
 * A revision number a definition declares.
 *
 * @category models
 * @since 0.0.0
 */
export type RevisionOf<E extends Entries> = keyof E & number

/**
 * One revision of one definition: everything needed to put a value on the
 * wire or read one back.
 *
 * @category models
 * @since 0.0.0
 */
export interface Revision<Tag extends string, Number extends number, Codec extends S.Top> {
  readonly tag: Tag
  readonly mid: number
  readonly revision: Number
  readonly codec: Codec
}

/**
 * Any revision, whatever its definition.
 *
 * @category models
 * @since 0.0.0
 */
export type AnyRevision = Revision<string, number, RevisionCodec>

/**
 * What every revision codec is: text on the wire, possibly reading the
 * {@link FrameContext} while decoding, needing nothing to encode.
 *
 * @category models
 * @since 0.0.0
 */
export interface RevisionCodec extends S.Codec<unknown, string, FrameContext, never> {}

/**
 * The value a revision decodes to.
 *
 * @category models
 * @since 0.0.0
 */
export type Type<Rev extends AnyRevision> = Rev["codec"]["Type"]

/**
 * What building a value of a revision takes: its fields, `_tag` and
 * `revision` optional.
 *
 * @category models
 * @since 0.0.0
 */
export type Payload<Rev extends AnyRevision> = Rev["codec"]["~type.make.in"]

/**
 * A message definition: its tag, its MID number and its revisions.
 *
 * @category models
 * @since 0.0.0
 */
export interface Definition<Tag extends string, E extends Entries> extends AnyDefinition {
  readonly tag: Tag
  readonly revisions: ReadonlyArray<RevisionOf<E>>
  readonly rev: <Number extends RevisionOf<E>>(
    revision: Number
  ) => Revision<Tag, Number, CodecOf<Tag, Number, E[Number]>>
}

/**
 * What every definition offers without knowing its revisions statically: its
 * identity, and a lookup by the revision a header carries.
 *
 * @category models
 * @since 0.0.0
 */
export interface AnyDefinition {
  readonly tag: string
  readonly mid: number
  readonly revisions: ReadonlyArray<number>
  readonly lookup: (revision: number) => O.Option<AnyRevision>
}

/**
 * The generic `0005` acknowledgement answers the request; `0004` rejects it.
 *
 * @category models
 * @since 0.0.0
 */
export class Accepted extends Data.TaggedClass("Accepted")<{}> {}

/**
 * Nothing answers the request: sending it is the whole exchange.
 *
 * @category models
 * @since 0.0.0
 */
export class NoReply extends Data.TaggedClass("NoReply")<{}> {}

/**
 * What a request revision expects back: a revision of another definition, the
 * generic acknowledgement, or nothing.
 *
 * @category models
 * @since 0.0.0
 */
export type Reply = AnyRevision | Accepted | NoReply

/**
 * The reply of a request answered by `0005`.
 *
 * @category constructors
 * @since 0.0.0
 */
export const accepted: Accepted = new Accepted()

/**
 * The reply of a request nothing answers.
 *
 * @category constructors
 * @since 0.0.0
 */
export const noReply: NoReply = new NoReply()

/**
 * A request revision: a revision plus the reply it expects.
 *
 * @category models
 * @since 0.0.0
 */
export interface RequestRevision<
  Tag extends string,
  Number extends number,
  Codec extends S.Top,
  Expected extends Reply
> extends Revision<Tag, Number, Codec> {
  readonly reply: Expected
}

/**
 * Any request revision.
 *
 * @category models
 * @since 0.0.0
 */
export type AnyRequestRevision = RequestRevision<string, number, RevisionCodec, Reply>

/**
 * A request definition: a definition whose every revision names its reply.
 *
 * @category models
 * @since 0.0.0
 */
export interface RequestDefinition<
  Tag extends string,
  E extends Entries,
  Replies extends { readonly [K in keyof E]: Reply }
> extends Omit<Definition<Tag, E>, "rev"> {
  readonly rev: <Number extends RevisionOf<E>>(
    revision: Number
  ) => RequestRevision<Tag, Number, CodecOf<Tag, Number, E[Number]>, Replies[Number]>
}

const tagged = (tag: string, revision: number): SchemaTransformation.Transformation<unknown, unknown> =>
  SchemaTransformation.transform<unknown, unknown>({
    decode: (fields) => (Predicate.isObject(fields) ? { ...fields, _tag: tag, revision } : fields),
    encode: (value) => (Predicate.isObject(value) ? R.remove(R.remove(value, "_tag"), "revision") : value)
  })

const structCodec = (tag: string, revision: number, layout: LayoutEntry): S.Top => {
  const from: S.Top = layout
  const to: S.Top = S.Struct({ _tag: S.tag(tag), revision: S.tag(revision), ...R.map(layout.to.fields, S.toType) })

  return from.pipe(S.decodeTo(to, tagged(tag, revision)))
}

const bindingCodec = (tag: string, revision: number, binding: Binding<S.Top, S.Top>): S.Top => {
  const from: S.Top = binding.layout
  const to: S.Top = binding.target

  return from.pipe(S.decodeTo(to, tagged(tag, revision)))
}

const codecFor = (tag: string, revision: number, entry: Entry): S.Top =>
  S.isSchema(entry)
    ? structCodec(tag, revision, entry)
    : Predicate.isTagged(entry, "Custom")
      ? entry.codec
      : bindingCodec(tag, revision, entry)

const revisionsOf = (entries: Entries): ReadonlyArray<number> => A.map(R.keys(entries), (key) => Number(key))

const make = (tag: string, mid: number, entries: Entries) => {
  const codecs = R.map(entries, (entry, key) => codecFor(tag, Number(key), entry))

  return {
    tag,
    mid,
    revisions: revisionsOf(entries),
    rev: (revision: number) => ({ tag, mid, revision, codec: codecs[`${revision}`] }),
    lookup: (revision: number) =>
      O.map(O.fromNullishOr(codecs[`${revision}`]), (codec) => ({ tag, mid, revision, codec }))
  }
}

/**
 * Defines a message: a tag, a MID number and one entry per revision.
 *
 * **Details**
 *
 * Each revision is its own Schema, so each has its own exact type. Revisions
 * that only append fields reuse the previous layout's entries with a spread;
 * a revision that changes a field simply lists a different layout. `rev(n)`
 * is only callable with a revision the definition declares.
 *
 * **Example** (A MID with two revisions)
 *
 * ```ts
 * import { Field, Mid } from "effect-open-protocol"
 *
 * const selected = [["parameterSetId", Field.digits({ width: 3 })]] as const
 *
 * const ParameterSetSelected = Mid.define({
 *   tag: "ParameterSetSelected",
 *   mid: 15,
 *   revisions: {
 *     1: Field.layout(selected),
 *     2: Field.layout([...selected, ["name", Field.text({ width: 25 })]])
 *   }
 * })
 *
 * const second = ParameterSetSelected.rev(2)
 * ```
 *
 * @category constructors
 * @since 0.0.0
 */
export function define<const Tag extends string, const E extends Entries>(options: {
  readonly tag: Tag
  readonly mid: number
  readonly revisions: E
}): Definition<Tag, E>
export function define(options: { readonly tag: string; readonly mid: number; readonly revisions: Entries }) {
  return make(options.tag, options.mid, options.revisions)
}

/**
 * Defines a request: a definition whose every revision also names the reply
 * it expects.
 *
 * **Details**
 *
 * `replies` must cover exactly the declared revisions. A reply is a revision
 * of another definition (a dedicated answer, such as `0065` for `0064`),
 * `accepted` (the generic `0005`, with `0004` as a rejection), or `noReply`.
 *
 * **Example** (A request answered by a dedicated reply)
 *
 * ```ts
 * import { Field, Mid } from "effect-open-protocol"
 *
 * const JobInfo = Mid.define({
 *   tag: "JobInfo",
 *   mid: 35,
 *   revisions: { 1: Field.layout([["jobId", Field.digits({ width: 4 })]]) }
 * })
 *
 * const JobInfoRequest = Mid.request({
 *   tag: "JobInfoRequest",
 *   mid: 34,
 *   revisions: { 1: Field.layout([]) },
 *   replies: { 1: JobInfo.rev(1) }
 * })
 * ```
 *
 * @category constructors
 * @since 0.0.0
 */
export function request<
  const Tag extends string,
  const E extends Entries,
  const Replies extends { readonly [K in keyof E]: Reply }
>(options: {
  readonly tag: Tag
  readonly mid: number
  readonly revisions: E
  readonly replies: Replies
}): RequestDefinition<Tag, E, Replies>
export function request(options: {
  readonly tag: string
  readonly mid: number
  readonly revisions: Entries
  readonly replies: { readonly [revision: number]: Reply }
}) {
  const definition = make(options.tag, options.mid, options.revisions)

  return {
    ...definition,
    rev: (revision: number) => ({ ...definition.rev(revision), reply: options.replies[revision] })
  }
}

/**
 * Writes a value of a revision as a complete frame, header and NUL terminator
 * included.
 *
 * **Example** (Encoding a request)
 *
 * ```ts
 * import { encode, RequestOldResult, TighteningId } from "effect-open-protocol"
 *
 * const frame = encode(RequestOldResult.rev(1), new RequestOldResult.Message({ tighteningId: TighteningId.make(0) }))
 * ```
 *
 * @category encoding
 * @since 0.0.0
 */
export const encode = <Rev extends AnyRevision>(
  revision: Rev,
  value: Type<Rev>
): Result.Result<string, PayloadEncodeError> =>
  pipe(
    S.encodeResult(revision.codec)(value),
    Result.mapError((error) => new PayloadEncodeError({ mid: revision.mid, reason: error.message })),
    Result.map(
      (data) =>
        encodeHeader(
          new Header({
            length: headerLength + Str.length(data),
            mid: revision.mid,
            revision: revision.revision,
            noAck: false,
            stationId: 1,
            spindleId: 1
          })
        ) +
        data +
        terminator
    )
  )

/**
 * Reads the data field of a frame as a value of a revision.
 *
 * @category decoding
 * @since 0.0.0
 */
export const decode = <Rev extends AnyRevision>(
  revision: Rev,
  data: string,
  deviceId: DeviceId
): Effect.Effect<Type<Rev>, PayloadDecodeError> =>
  pipe(
    S.decodeEffect(revision.codec)(data),
    Effect.provideService(FrameContext, { deviceId }),
    Effect.mapError((error) => new PayloadDecodeError({ mid: revision.mid, reason: error.message }))
  )
