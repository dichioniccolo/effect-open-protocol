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
import * as Context from "effect/Context"
import * as O from "effect/Option"
import * as R from "effect/Record"
import * as S from "effect/Schema"
import type * as SchemaIssue from "effect/SchemaIssue"
import * as SchemaTransformation from "effect/SchemaTransformation"
import { encodeFrame } from "./Header.ts"
// Type-only: `Messages.ts` builds on this module, so the edge must not exist at runtime.
import type { CommandAccepted, Incoming } from "./Messages.ts"
import { PayloadDecodeError, PayloadEncodeError, UnexpectedRevision } from "./ProtocolError.ts"
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
 * **Example** (Decoding a revision that stamps the device)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { DeviceId, Mid, OldResultMid } from "effect-open-protocol"
 *
 * declare const data: string
 *
 * // `Mid.decode` provides the context; a codec reads it with `FrameContext.use`.
 * const decoded = Mid.decode(OldResultMid.rev(1), data, DeviceId.make("tool-1"))
 * ```
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
 * A revision written as a ready codec, for values whose shape differs from the
 * wire record. The codec must produce `_tag` and `revision` itself.
 *
 * **Example** (Inspecting a custom revision)
 *
 * ```ts
 * import * as S from "effect/Schema"
 * import { Mid } from "effect-open-protocol"
 *
 * declare const codec: S.Codec<{ readonly _tag: "Raw"; readonly revision: 1 }, string>
 *
 * console.log(Mid.custom(codec)._tag) // "Custom"
 * ```
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
 * How a reply can go wrong once it has been recognised.
 *
 * @category models
 * @since 0.0.0
 */
export type ReplyError = UnexpectedRevision | PayloadDecodeError

/**
 * What a request waits for: something that recognises, among incoming frames,
 * the one that answers it.
 *
 * **Details**
 *
 * A revision is a reply (a frame of its MID answers, decoded at that
 * revision); so are {@link accepted} (the `0005` naming the request) and
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
  /** The reply to a request for MID `request`, if `incoming` is it. */
  readonly answer: (request: number, incoming: Incoming) => O.Option<Effect.Effect<A, ReplyError, FrameContext>>
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
 * What every revision codec is: text on the wire, possibly reading the
 * {@link FrameContext} while decoding, needing nothing to encode.
 *
 * @category models
 * @since 0.0.0
 */
export interface RevisionCodec extends S.Codec<unknown, string, FrameContext, never> {}

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
  readonly lookup: (revision: number) => O.Option<Revision<string, number, S.Codec<A, string, FrameContext, never>>>
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
 * The generic `0005` acknowledgement answers the request; `0004` rejects it.
 *
 * **Example** (Declaring a request answered by 0005)
 *
 * ```ts
 * import { Field, Mid } from "effect-open-protocol"
 *
 * const Reset = Mid.request(Mid.define({ tag: "Reset", mid: 9200, revisions: { 1: Field.layout([]) } }), {
 *   1: Mid.accepted
 * })
 * ```
 *
 * @category models
 * @since 0.0.0
 */
export class Accepted extends Data.TaggedClass("Accepted")<{}> implements Reply<CommandAccepted> {
  readonly settled: O.Option<CommandAccepted> = O.none()

  readonly answer: Reply<CommandAccepted>["answer"] = (request, incoming) => {
    const message = incoming.message

    return Predicate.isTagged(message, "CommandAccepted") && message.mid === request
      ? O.some(Effect.succeed(message))
      : O.none()
  }
}

/**
 * Nothing answers the request: sending it is the whole exchange.
 *
 * **Example** (Declaring a request nothing answers)
 *
 * ```ts
 * import { Field, Mid } from "effect-open-protocol"
 *
 * const Notify = Mid.request(Mid.define({ tag: "Notify", mid: 9201, revisions: { 1: Field.layout([]) } }), {
 *   1: Mid.noReply
 * })
 * ```
 *
 * @category models
 * @since 0.0.0
 */
export class NoReply extends Data.TaggedClass("NoReply")<{}> implements Reply<void> {
  readonly settled: O.Option<void> = O.some(undefined)

  readonly answer: Reply<void>["answer"] = () => O.none()
}

/**
 * The reply of a request answered by `0005`.
 *
 * **Example** (A request acknowledged by 0005)
 *
 * ```ts
 * import { Field, Mid } from "effect-open-protocol"
 *
 * const Select = Mid.request(Mid.define({ tag: "Select", mid: 9202, revisions: { 1: Field.layout([]) } }), {
 *   1: Mid.accepted
 * })
 * ```
 *
 * @category constructors
 * @since 0.0.0
 */
export const accepted: Accepted = new Accepted()

/**
 * The reply of a request nothing answers.
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

// A plain layout is a binding to the tagged struct of its own fields.
const bindingOf = (tag: string, revision: number, entry: LayoutEntry | Binding<S.Top, S.Top>): Binding<S.Top, S.Top> =>
  S.isSchema(entry)
    ? as(S.Struct({ _tag: S.tag(tag), revision: S.tag(revision), ...R.map(entry.to.fields, S.toType) }), entry)
    : entry

// The entry's own schemas are erased here; `CodecOf` is the typed view of
// what this returns, the same way `define` types what `make` builds.
function codecFor(tag: string, revision: number, entry: Entry): RevisionCodec
function codecFor(tag: string, revision: number, entry: Entry): S.Top {
  if (!S.isSchema(entry) && Predicate.isTagged(entry, "Custom")) {
    return entry.codec
  }

  const binding = bindingOf(tag, revision, entry)
  const from: S.Top = binding.layout

  return from.pipe(S.decodeTo(binding.target, tagged(tag, revision)))
}

/**
 * Reads the data field of a frame as a value of a revision, reading the
 * device from the {@link FrameContext}.
 */
const decodeIn = <Rev extends AnyRevision>(
  revision: Rev,
  data: string
): Effect.Effect<Type<Rev>, PayloadDecodeError, FrameContext> =>
  Effect.mapError(
    S.decodeEffect(revision.codec)(data),
    (error) => new PayloadDecodeError({ mid: revision.mid, reason: error.message })
  )

const revisionOf = (tag: string, mid: number, revision: number, codec: RevisionCodec): AnyRevision => {
  const self: AnyRevision = {
    tag,
    mid,
    revision,
    codec,
    settled: O.none(),
    answer: (_request, incoming) =>
      incoming.header.mid !== mid
        ? O.none()
        : O.some(
            incoming.header.revision === revision
              ? decodeIn(self, incoming.data)
              : Effect.fail(new UnexpectedRevision({ mid, expected: revision, received: incoming.header.revision }))
          )
  }

  return self
}

/** `rev` was called with a revision the definition does not declare, which its type rules out. */
class UndeclaredRevision extends S.TaggedError<UndeclaredRevision>()("UndeclaredRevision", {
  mid: S.Number,
  revision: S.Number
}) {}

/** What `define` builds before its overload types it: revisions with erased codecs. */
interface Untyped {
  readonly tag: string
  readonly mid: number
  readonly revisions: ReadonlyArray<number>
  readonly rev: (revision: number) => Revision<string, number, S.Top>
  readonly lookup: (revision: number) => O.Option<Revision<string, number, S.Top>>
}

const make = (tag: string, mid: number, entries: Entries): Untyped => {
  const revisions = R.map(entries, (entry, key) => revisionOf(tag, mid, Number(key), codecFor(tag, Number(key), entry)))
  const lookup = (revision: number): O.Option<AnyRevision> => R.get(revisions, `${revision}`)

  return {
    tag,
    mid,
    revisions: A.map(R.keys(entries), (key) => Number(key)),
    rev: (revision: number): AnyRevision =>
      O.getOrThrowWith(lookup(revision), () => new UndeclaredRevision({ mid, revision })),
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
 * is only callable with a revision the definition declares. The tag names
 * the plain struct a bare layout decodes into; `as` and `custom` revisions
 * carry their own.
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
 * Makes a definition a request: every revision also names the reply it
 * expects.
 *
 * **Details**
 *
 * `replies` must cover exactly the declared revisions. A reply is a revision
 * of any definition (a dedicated answer, such as `0065` for `0064`, or the
 * request's own definition for a message the controller mirrors), `accepted`
 * (the generic `0005`, with `0004` as a rejection), or `noReply`.
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
export function request(definition: Untyped, replies: { readonly [revision: number]: Reply }) {
  return { ...definition, rev: (revision: number) => ({ ...definition.rev(revision), reply: replies[revision] }) }
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
 * import { CommandAcceptedMid, DeviceId, Mid } from "effect-open-protocol"
 *
 * const accepted = Mid.decode(CommandAcceptedMid.rev(1), "0060", DeviceId.make("tool-1"))
 *
 * Effect.runPromise(accepted).then((message) => console.log(message.mid)) // 60
 * ```
 *
 * @category decoding
 * @since 0.0.0
 */
export const decode = <Rev extends AnyRevision>(
  revision: Rev,
  data: string,
  deviceId: DeviceId
): Effect.Effect<Type<Rev>, PayloadDecodeError> =>
  Effect.provideService(decodeIn(revision, data), FrameContext, { deviceId })
