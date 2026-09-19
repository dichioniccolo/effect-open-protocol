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
import { Data, Effect, Predicate, Result } from "effect"
import * as A from "effect/Array"
import * as O from "effect/Option"
import * as R from "effect/Record"
import * as S from "effect/Schema"
import type * as SchemaIssue from "effect/SchemaIssue"
import * as SchemaTransformation from "effect/SchemaTransformation"
import { encodeFrame, type Header } from "./Header.ts"
import { PayloadDecodeError, PayloadEncodeError, UnexpectedRevision } from "./ProtocolError.ts"

/**
 * A revision whose value is a class: the layout decodes into the class's
 * fields, the definition adds `_tag` and `revision`.
 *
 * **Example** (Inspecting a binding)
 *
 * ```ts
 * import * as S from "effect/Schema"
 * import { Field, Mid } from "effect-open-protocol"
 *
 * class Ping extends S.TaggedClass<Ping>()("Ping", { revision: S.tag(1) }) {}
 *
 * const binding = Mid.as(Ping, Field.layout([]))
 *
 * console.log(binding._tag) // "Binding"
 * ```
 *
 * @category models
 * @since 0.0.0
 */
export class Binding<Target extends S.Top, Layout extends S.Top> extends Data.TaggedClass("Binding")<{
  readonly target: Target
  readonly layout: Layout
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
 * One revision of a definition, as written: a `Field.layout` (decoded into a
 * plain tagged struct) or `as(Class, layout)`.
 *
 * @category models
 * @since 0.0.0
 */
export type Entry = LayoutEntry | Binding<S.Top, S.Top>

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
 * The entries of a definition, each `as` revision required to decode into
 * the definition's tag and the revision number it is declared under.
 *
 * **Details**
 *
 * The definition writes `_tag` and `revision` onto what the layout decoded,
 * so a class whose own tag or revision disagrees would fail every decode at
 * runtime. This rejects it at compile time instead.
 *
 * @category models
 * @since 0.0.0
 */
export type Checked<Tag extends string, E extends Entries> = {
  readonly [Number in keyof E]: E[Number] extends Binding<infer Target, S.Top>
    ? Target["Type"] extends { readonly _tag: Tag; readonly revision: Number }
      ? E[Number]
      : Binding<S.Codec<{ readonly _tag: Tag; readonly revision: Number }>, S.Top>
    : E[Number]
}

/**
 * A revision number a definition declares.
 *
 * @category models
 * @since 0.0.0
 */
export type RevisionOf<E extends Entries> = keyof E & number

/**
 * How a reply can go wrong once it has been recognised.
 *
 * @category models
 * @since 0.0.0
 */
export type ReplyError = UnexpectedRevision | PayloadDecodeError

/**
 * A received frame as a reply sees it: its header, its data field as it
 * came, and whatever message it decoded to.
 *
 * @category models
 * @since 0.0.0
 */
export interface Received {
  readonly header: Header
  readonly data: string
  readonly message: unknown
}

/**
 * What a request waits for: something that recognises, among incoming frames,
 * the one that answers it.
 *
 * **Details**
 *
 * A revision is a reply (a frame of its MID answers, decoded at that
 * revision); so are `commandAccepted` (the `0005` naming the request) and
 * {@link noReply} (nothing is awaited, the request is settled once sent).
 * `answer` returns `None` for a frame that is not the reply, so it stays
 * unsolicited traffic.
 *
 * @category models
 * @since 0.0.0
 */
export interface Reply<A = unknown> {
  /** What the request resolves to as soon as it is sent, when nothing answers it. */
  readonly settled: O.Option<A>
  /** The reply to a request for MID `request`, if `received` is it. */
  readonly answer: (request: number, received: Received) => O.Option<Effect.Effect<A, ReplyError>>
}

/**
 * One revision of one definition: everything needed to put a value on the
 * wire or read one back. A revision is also the reply that awaits it.
 *
 * @category models
 * @since 0.0.0
 */
export interface Revision<Tag extends string, Number extends number, Codec extends S.Top> extends Reply<Codec["Type"]> {
  readonly tag: Tag
  readonly mid: number
  readonly revision: Number
  readonly codec: Codec
}

/**
 * What every revision codec is: text on the wire, needing no service either
 * way.
 *
 * @category models
 * @since 0.0.0
 */
export interface RevisionCodec extends S.Codec<unknown, string> {}

/**
 * Any revision, whatever its definition.
 *
 * @category models
 * @since 0.0.0
 */
export type AnyRevision = Revision<string, number, RevisionCodec>

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
 * The value any revision of a definition decodes to.
 *
 * @category models
 * @since 0.0.0
 */
export type ValueOf<Tag extends string, E extends Entries> = {
  readonly [Number in RevisionOf<E>]: CodecOf<Tag, Number, E[Number]>["Type"]
}[RevisionOf<E>]

/**
 * What every definition offers without knowing its revisions statically: its
 * identity, and a lookup by the revision a header carries. `A` is what any of
 * its revisions decodes to.
 *
 * @category models
 * @since 0.0.0
 */
export interface AnyDefinition<A = unknown> {
  readonly tag: string
  readonly mid: number
  readonly revisions: ReadonlyArray<number>
  readonly lookup: (revision: number) => O.Option<Revision<string, number, S.Codec<A, string>>>
}

/**
 * A message definition: its tag, its MID number and its revisions.
 *
 * @category models
 * @since 0.0.0
 */
export interface Definition<Tag extends string, E extends Entries> extends AnyDefinition<ValueOf<Tag, E>> {
  readonly tag: Tag
  readonly revisions: ReadonlyArray<RevisionOf<E>>
  readonly rev: <Number extends RevisionOf<E>>(
    revision: Number
  ) => Revision<Tag, Number, CodecOf<Tag, Number, E[Number]>>
}

/**
 * The reply of a request nothing answers: sending it is the whole exchange.
 *
 * **Example** (A fire-and-forget request)
 *
 * ```ts
 * import { Field, Mid } from "effect-open-protocol"
 *
 * const Beep = Mid.request(Mid.define({ tag: "Beep", mid: 9203, revisions: { 1: Field.layout([]) } }), {
 *   1: Mid.noReply
 * })
 * ```
 *
 * @category constructors
 * @since 0.0.0
 */
export const noReply: Reply<void> = { settled: O.some(undefined), answer: () => O.none() }

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
 * What a request revision resolves to: whatever its reply recognises.
 *
 * @category models
 * @since 0.0.0
 */
export type ReplyOf<Rev extends AnyRequestRevision> = Rev["reply"] extends Reply<infer A> ? A : never

/**
 * A request definition: a definition whose every revision names its reply.
 *
 * @category models
 * @since 0.0.0
 */
export interface RequestDefinition<
  Tag extends string,
  E extends Entries,
  Replies extends { readonly [Number in RevisionOf<E>]: Reply }
> extends Omit<Definition<Tag, E>, "rev" | "lookup"> {
  readonly rev: <Number extends RevisionOf<E>>(
    revision: Number
  ) => RequestRevision<Tag, Number, CodecOf<Tag, Number, E[Number]>, Replies[Number]>
  readonly lookup: (
    revision: number
  ) => O.Option<RequestRevision<string, number, S.Codec<ValueOf<Tag, E>, string>, Replies[RevisionOf<E>]>>
}

const tagged = (tag: string, revision: number): SchemaTransformation.Transformation<unknown, unknown> =>
  SchemaTransformation.transform<unknown, unknown>({
    decode: (fields) => (Predicate.isObject(fields) ? { ...fields, _tag: tag, revision } : fields),
    encode: (value) => (Predicate.isObject(value) ? R.remove(R.remove(value, "_tag"), "revision") : value)
  })

// The entry's own schemas are erased here; `CodecOf` is the typed view of
// what this returns, the same way `define` types what it builds.
function codecFor(tag: string, revision: number, entry: Entry): RevisionCodec
function codecFor(tag: string, revision: number, entry: Entry): S.Top {
  // A plain layout is a binding to the tagged struct of its own fields.
  const binding = S.isSchema(entry)
    ? as(S.Struct({ _tag: S.tag(tag), revision: S.tag(revision), ...R.map(entry.to.fields, S.toType) }), entry)
    : entry

  const from: S.Top = binding.layout

  return from.pipe(S.decodeTo(binding.target, tagged(tag, revision)))
}

const revisionOf = (tag: string, mid: number, revision: number, codec: RevisionCodec): AnyRevision => {
  const self: AnyRevision = {
    tag,
    mid,
    revision,
    codec,
    settled: O.none(),
    answer: (_request, received) =>
      received.header.mid !== mid
        ? O.none()
        : O.some(
            received.header.revision === revision
              ? decode(self, received.data)
              : Effect.fail(new UnexpectedRevision({ mid, expected: revision, received: received.header.revision }))
          )
  }

  return self
}

/** `rev` was called with a revision the definition does not declare, which its type rules out. */
class UndeclaredRevision extends S.TaggedError<UndeclaredRevision>()("UndeclaredRevision", {
  mid: S.Number,
  revision: S.Number
}) {}

/** What `define` and `request` build before their overloads type it: revisions with erased codecs. */
interface Untyped<Rev> {
  readonly tag: string
  readonly mid: number
  readonly revisions: ReadonlyArray<number>
  readonly rev: (revision: number) => Rev
  readonly lookup: (revision: number) => O.Option<Rev>
}

// Built once per definition, so `rev(n)` and `lookup(n)` return the same revision every time.
const indexed = <Rev>(tag: string, mid: number, byRevision: R.ReadonlyRecord<string, Rev>): Untyped<Rev> => {
  const lookup = (revision: number): O.Option<Rev> => R.get(byRevision, `${revision}`)

  return {
    tag,
    mid,
    revisions: A.map(R.keys(byRevision), (key) => Number(key)),
    rev: (revision) => O.getOrThrowWith(lookup(revision), () => new UndeclaredRevision({ mid, revision })),
    lookup
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
 * is only callable with a revision the definition declares. A bare layout
 * decodes into a plain struct tagged with `tag`; an `as` revision decodes
 * into its class, whose tag and revision must match the definition's (see
 * {@link Checked}).
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
  readonly revisions: E & Checked<Tag, E>
}): Definition<Tag, E>
export function define(options: {
  readonly tag: string
  readonly mid: number
  readonly revisions: Entries
}): Untyped<Revision<string, number, S.Top>> {
  return indexed(
    options.tag,
    options.mid,
    R.map(options.revisions, (entry, key) =>
      revisionOf(options.tag, options.mid, Number(key), codecFor(options.tag, Number(key), entry))
    )
  )
}

/**
 * Makes a definition a request: every revision also names the reply it
 * expects.
 *
 * **Details**
 *
 * `replies` must cover exactly the declared revisions. A reply is a revision
 * of any definition (a dedicated answer, such as `0065` for `0064`, or the
 * request's own definition for a message the controller mirrors),
 * `commandAccepted` (the generic `0005`, with `0004` as a rejection), or
 * {@link noReply}.
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
 * const JobInfoRequest = Mid.request(Mid.define({ tag: "JobInfoRequest", mid: 34, revisions: { 1: Field.layout([]) } }), {
 *   1: JobInfo.rev(1)
 * })
 * ```
 *
 * @category constructors
 * @since 0.0.0
 */
export function request<
  const Tag extends string,
  const E extends Entries,
  const Replies extends { readonly [Number in RevisionOf<E>]: Reply }
>(definition: Definition<Tag, E>, replies: Replies): RequestDefinition<Tag, E, Replies>
export function request(
  definition: Untyped<Revision<string, number, S.Top>>,
  replies: { readonly [revision: number]: Reply }
): Untyped<RequestRevision<string, number, S.Top, Reply>> {
  return indexed(
    definition.tag,
    definition.mid,
    R.map(replies, (reply, key) => ({ ...definition.rev(Number(key)), reply }))
  )
}

const encodeError =
  (mid: number) =>
  (issue: SchemaIssue.Issue): PayloadEncodeError =>
    new PayloadEncodeError({ mid, reason: `${issue}` })

/**
 * Writes a value of a revision as a complete frame, header and NUL terminator
 * included.
 *
 * **Example** (Encoding a request)
 *
 * ```ts
 * import { Mid, RequestOldResult, RequestOldResultMid, TighteningId } from "effect-open-protocol"
 *
 * const frame = Mid.encode(RequestOldResultMid.rev(1), new RequestOldResult({ tighteningId: TighteningId.make(0) }))
 * ```
 *
 * @category encoding
 * @since 0.0.0
 */
export const encode = <Rev extends AnyRevision>(
  revision: Rev,
  value: Type<Rev>
): Result.Result<string, PayloadEncodeError> =>
  Result.map(
    Result.mapError(S.encodeResult(revision.codec)(value), (error) => encodeError(revision.mid)(error.issue)),
    (data) => encodeFrame(revision.mid, revision.revision, data)
  )

/**
 * Builds a value of a revision from its payload and writes it as a complete
 * frame; a payload its fields cannot carry fails before anything is written.
 *
 * **Example** (The frame of an old-result request)
 *
 * ```ts
 * import { Mid, RequestOldResultMid, TighteningId } from "effect-open-protocol"
 *
 * const frame = Mid.frame(RequestOldResultMid.rev(1), { tighteningId: TighteningId.make(0) })
 * ```
 *
 * @category encoding
 * @since 0.0.0
 */
export const frame = <Rev extends AnyRevision>(
  revision: Rev,
  payload: Payload<Rev>
): Effect.Effect<string, PayloadEncodeError> =>
  Effect.gen(function* () {
    const value = yield* Effect.mapError(revision.codec.makeEffect(payload), encodeError(revision.mid))

    return yield* Effect.fromResult(encode(revision, value))
  })

/**
 * Reads the data field of a frame as a value of a revision.
 *
 * **Example** (Reading a data field as MID 0005 revision 1)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { CommandAcceptedMid, Mid } from "effect-open-protocol"
 *
 * const accepted = Mid.decode(CommandAcceptedMid.rev(1), "0060")
 *
 * Effect.runPromise(accepted).then((message) => console.log(message.mid)) // 60
 * ```
 *
 * @category decoding
 * @since 0.0.0
 */
export const decode = <Rev extends AnyRevision>(
  revision: Rev,
  data: string
): Effect.Effect<Type<Rev>, PayloadDecodeError> =>
  Effect.mapError(
    S.decodeEffect(revision.codec)(data),
    (error) => new PayloadDecodeError({ mid: revision.mid, reason: error.message })
  )
