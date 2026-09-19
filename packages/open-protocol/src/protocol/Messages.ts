/**
 * The Open Protocol messages this library speaks, defined with `Mid`.
 *
 * Only the subset the library needs is modelled: communication start/stop,
 * generic accept/error, last tightening result subscribe/data/acknowledge/
 * unsubscribe, old result upload request/reply and keep-alive. Each is a
 * class for its values and a `Mid` definition for its wire format, the same
 * mechanism a user-defined MID goes through. Any other MID, or a revision the
 * library does not define, decodes to `UnknownMessage` so it can be logged
 * and dropped instead of breaking the connection.
 *
 * @since 0.0.0
 */
import { Effect, Match, Result } from "effect"
import * as A from "effect/Array"
import * as O from "effect/Option"
import * as R from "effect/Record"
import * as S from "effect/Schema"
import * as Str from "effect/String"
import * as Field from "./Field.ts"
import { decodeHeader, encodeFrame, Header, headerLength, MidNumber, RevisionNumber } from "./Header.ts"
import * as Mid from "./Mid.ts"
import { type MalformedHeader, PayloadEncodeError, type UnsupportedFeature } from "./ProtocolError.ts"
import { LastResultBody, OldResultBody, ResultFields, TighteningId } from "./TighteningResult.ts"

/**
 * Enables the communication with a controller (MID 0001).
 *
 * @category models
 * @since 0.0.0
 */
export class CommunicationStart extends S.TaggedClass<CommunicationStart>()(
  "CommunicationStart",
  { revision: S.tag(1) },
  {
    description: "MID 0001, opens the session"
  }
) {}

/**
 * The controller accepted the session and describes itself (MID 0002).
 *
 * @category models
 * @since 0.0.0
 */
export class CommunicationStartAccepted extends S.TaggedClass<CommunicationStartAccepted>()(
  "CommunicationStartAccepted",
  {
    revision: S.tag(1),
    cellId: S.Number.check(S.isInt(), S.isBetween({ minimum: 0, maximum: 9999 })),
    channelId: S.Number.check(S.isInt(), S.isBetween({ minimum: 0, maximum: 99 })),
    controllerName: S.String
  },
  { description: "MID 0002, session accepted" }
) {}

/**
 * Closes the communication (MID 0003).
 *
 * @category models
 * @since 0.0.0
 */
export class CommunicationStop extends S.TaggedClass<CommunicationStop>()(
  "CommunicationStop",
  { revision: S.tag(1) },
  {
    description: "MID 0003, closes the session"
  }
) {}

/**
 * The controller rejected the last command (MID 0004).
 *
 * @category models
 * @since 0.0.0
 */
export class CommandError extends S.TaggedClass<CommandError>()(
  "CommandError",
  {
    revision: S.tag(1),
    mid: MidNumber,
    code: S.Number.check(S.isInt(), S.isBetween({ minimum: 0, maximum: 99 }))
  },
  { description: "MID 0004, negative acknowledge carrying the failed MID" }
) {}

/**
 * The controller accepted the last command (MID 0005).
 *
 * @category models
 * @since 0.0.0
 */
export class CommandAccepted extends S.TaggedClass<CommandAccepted>()(
  "CommandAccepted",
  {
    revision: S.tag(1),
    mid: MidNumber
  },
  { description: "MID 0005, positive acknowledge carrying the accepted MID" }
) {}

/**
 * Subscribes to tightening results in reliable mode (MID 0060).
 *
 * @category models
 * @since 0.0.0
 */
export class SubscribeResults extends S.TaggedClass<SubscribeResults>()(
  "SubscribeResults",
  { revision: S.tag(1) },
  {
    description: "MID 0060, subscribes to the last tightening result"
  }
) {}

/**
 * A pushed tightening result (MID 0061), as the controller reports it: the
 * result's fields, without the device, plus when its parameter set last
 * changed. `resultOf` stamps it with the device it came from.
 *
 * @category models
 * @since 0.0.0
 */
export class LastResult extends S.TaggedClass<LastResult>()(
  "LastResult",
  {
    revision: S.tag(1),
    ...ResultFields,
    parameterSetChangedAt: S.String
  },
  { description: "MID 0061, last tightening result" }
) {}

/**
 * Acknowledges a pushed tightening result (MID 0062).
 *
 * @category models
 * @since 0.0.0
 */
export class AcknowledgeResult extends S.TaggedClass<AcknowledgeResult>()(
  "AcknowledgeResult",
  { revision: S.tag(1) },
  {
    description: "MID 0062, acknowledges the last tightening result"
  }
) {}

/**
 * Cancels the tightening result subscription (MID 0063).
 *
 * @category models
 * @since 0.0.0
 */
export class UnsubscribeResults extends S.TaggedClass<UnsubscribeResults>()(
  "UnsubscribeResults",
  { revision: S.tag(1) },
  {
    description: "MID 0063, unsubscribes from tightening results"
  }
) {}

/**
 * Requests a stored result by its tightening id; `0` asks for the latest one
 * (MID 0064).
 *
 * @category models
 * @since 0.0.0
 */
export class RequestOldResult extends S.TaggedClass<RequestOldResult>()(
  "RequestOldResult",
  {
    revision: S.tag(1),
    tighteningId: TighteningId
  },
  { description: "MID 0064, uploads an old tightening result by id" }
) {}

/**
 * A stored result returned by the controller (MID 0065), as reported: the
 * result's fields without the device. `resultOf` stamps it.
 *
 * @category models
 * @since 0.0.0
 */
export class OldResult extends S.TaggedClass<OldResult>()(
  "OldResult",
  {
    revision: S.tag(1),
    ...ResultFields
  },
  { description: "MID 0065, old tightening result reply" }
) {}

/**
 * Keep-alive, mirrored by the controller (MID 9999).
 *
 * @category models
 * @since 0.0.0
 */
export class KeepAlive extends S.TaggedClass<KeepAlive>()(
  "KeepAlive",
  { revision: S.tag(1) },
  {
    description: "MID 9999, keep-alive"
  }
) {}

/**
 * A well-formed frame carrying a MID this library does not model.
 *
 * @category models
 * @since 0.0.0
 */
export class UnknownMessage extends S.TaggedClass<UnknownMessage>()(
  "UnknownMessage",
  {
    mid: MidNumber,
    revision: RevisionNumber,
    data: S.String
  },
  { description: "A frame whose MID is outside the supported subset" }
) {}

/**
 * Every message this library can decode.
 *
 * **Example** (Guarding a decoded value)
 *
 * ```ts
 * import * as S from "effect/Schema"
 * import { KeepAlive, Message } from "effect-open-protocol"
 *
 * console.log(S.is(Message)(new KeepAlive())) // true
 * ```
 *
 * @category models
 * @since 0.0.0
 */
export const Message = S.Union([
  CommunicationStart,
  CommunicationStartAccepted,
  CommunicationStop,
  CommandError,
  CommandAccepted,
  SubscribeResults,
  LastResult,
  AcknowledgeResult,
  UnsubscribeResults,
  RequestOldResult,
  OldResult,
  KeepAlive,
  UnknownMessage
]).annotate({ identifier: "Message", description: "A decoded Open Protocol message" })

/**
 * @category models
 * @since 0.0.0
 */
export type Message = typeof Message.Type

/**
 * A decoded frame as a session reads it: its header, its data field as it
 * came, and the message it decoded to. A reply is recognised by its header
 * (see `Mid.Reply`), whatever message it decoded to.
 *
 * @category models
 * @since 0.0.0
 */
export class Incoming extends S.Class<Incoming>("Incoming")(
  {
    header: Header,
    data: S.String,
    message: Message
  },
  { description: "A decoded frame with the header and data field it came in" }
) {}

const acknowledging =
  <A extends { readonly mid: number }>(is: (message: unknown) => message is A) =>
  (request: number, received: Mid.Received): O.Option<A> =>
    O.filter(O.liftPredicate(received.message, is), (message) => message.mid === request)

/**
 * The `0004` rejecting a request for MID `request`, if `received` is it.
 *
 * **Example** (Recognising a rejection)
 *
 * ```ts
 * import { type Incoming, rejectionOf } from "effect-open-protocol"
 *
 * declare const incoming: Incoming
 *
 * const refused = rejectionOf(60, incoming)
 * ```
 *
 * @category replies
 * @since 0.0.0
 */
export const rejectionOf: (request: number, received: Mid.Received) => O.Option<CommandError> = acknowledging(
  S.is(CommandError)
)

const acceptanceOf = acknowledging(S.is(CommandAccepted))

/**
 * The reply of a request the generic `0005` answers: the acknowledgement that
 * names the request's MID. A `0004` naming it is a rejection.
 *
 * **Example** (Declaring a request answered by 0005)
 *
 * ```ts
 * import { commandAccepted, Field, Mid } from "effect-open-protocol"
 *
 * const Reset = Mid.request(Mid.define({ tag: "Reset", mid: 9200, revisions: { 1: Field.layout([]) } }), {
 *   1: commandAccepted
 * })
 * ```
 *
 * @category replies
 * @since 0.0.0
 */
export const commandAccepted: Mid.Reply<CommandAccepted> = {
  settled: O.none(),
  answer: (request, received) => O.map(acceptanceOf(request, received), Effect.succeed)
}

const mid = Field.digits({ width: 4 })

/**
 * MID 0002 revision 1: the controller accepted the session.
 *
 * **Example** (Reading the controller's answer to the handshake)
 *
 * ```ts
 * import * as Str from "effect/String"
 * import { CommunicationStartAcceptedMid, Mid } from "effect-open-protocol"
 *
 * const data = "010001" + "0201" + "03" + Str.padEnd(25, " ")("Airbag1")
 *
 * const accepted = Mid.decode(CommunicationStartAcceptedMid.rev(1), data)
 * ```
 *
 * @category definitions
 * @since 0.0.0
 */
export const CommunicationStartAcceptedMid = Mid.define({
  tag: "CommunicationStartAccepted",
  mid: 2,
  revisions: {
    1: Mid.as(
      CommunicationStartAccepted,
      Field.layout([
        ["cellId", Field.digits({ id: "01", width: 4 })],
        ["channelId", Field.digits({ id: "02", width: 2 })],
        ["controllerName", Field.text({ id: "03", width: 25 })]
      ])
    )
  }
})

/**
 * MID 0001 revision 1: opens the session, answered by MID 0002.
 *
 * **Example** (Opening a session by hand)
 *
 * ```ts
 * import { DeviceConnection, CommunicationStartMid } from "effect-open-protocol"
 *
 * declare const connection: DeviceConnection.DeviceConnectionService
 *
 * // The reply is typed as `CommunicationStartAccepted`.
 * const accepted = connection.request(CommunicationStartMid.rev(1), {})
 * ```
 *
 * @category definitions
 * @since 0.0.0
 */
export const CommunicationStartMid = Mid.request(
  Mid.define({ tag: "CommunicationStart", mid: 1, revisions: { 1: Mid.as(CommunicationStart, Field.layout([])) } }),
  { 1: CommunicationStartAcceptedMid.rev(1) }
)

/**
 * MID 0003 revision 1: closes the session.
 *
 * **Example** (Asking the controller to close the session)
 *
 * ```ts
 * import { DeviceConnection, CommunicationStopMid } from "effect-open-protocol"
 *
 * declare const connection: DeviceConnection.DeviceConnectionService
 *
 * const stopped = connection.request(CommunicationStopMid.rev(1), {})
 * ```
 *
 * @category definitions
 * @since 0.0.0
 */
export const CommunicationStopMid = Mid.request(
  Mid.define({ tag: "CommunicationStop", mid: 3, revisions: { 1: Mid.as(CommunicationStop, Field.layout([])) } }),
  { 1: commandAccepted }
)

/**
 * MID 0004 revision 1: the controller rejected a command.
 *
 * **Example** (Encoding a rejection)
 *
 * ```ts
 * import { CommandError, CommandErrorMid, Mid } from "effect-open-protocol"
 *
 * const frame = Mid.encode(CommandErrorMid.rev(1), new CommandError({ mid: 64, code: 15 }))
 * ```
 *
 * @category definitions
 * @since 0.0.0
 */
export const CommandErrorMid = Mid.define({
  tag: "CommandError",
  mid: 4,
  revisions: {
    1: Mid.as(
      CommandError,
      Field.layout([
        ["mid", mid],
        ["code", Field.digits({ width: 2 })]
      ])
    )
  }
})

/**
 * MID 0005 revision 1: the controller accepted a command.
 *
 * **Example** (Encoding an acknowledgement)
 *
 * ```ts
 * import { CommandAccepted, CommandAcceptedMid, Mid } from "effect-open-protocol"
 *
 * const frame = Mid.encode(CommandAcceptedMid.rev(1), new CommandAccepted({ mid: 60 }))
 * ```
 *
 * @category definitions
 * @since 0.0.0
 */
export const CommandAcceptedMid = Mid.define({
  tag: "CommandAccepted",
  mid: 5,
  revisions: { 1: Mid.as(CommandAccepted, Field.layout([["mid", mid]])) }
})

/**
 * MID 0060 revision 1: subscribes to tightening results.
 *
 * **Example** (Subscribing by hand)
 *
 * ```ts
 * import { DeviceConnection, SubscribeResultsMid } from "effect-open-protocol"
 *
 * declare const connection: DeviceConnection.DeviceConnectionService
 *
 * // The reply is the 0005 that names MID 60.
 * const accepted = connection.request(SubscribeResultsMid.rev(1), {})
 * ```
 *
 * @category definitions
 * @since 0.0.0
 */
export const SubscribeResultsMid = Mid.request(
  Mid.define({ tag: "SubscribeResults", mid: 60, revisions: { 1: Mid.as(SubscribeResults, Field.layout([])) } }),
  { 1: commandAccepted }
)

/**
 * MID 0061 revision 1: a pushed tightening result.
 *
 * **Example** (Reading a pushed result)
 *
 * ```ts
 * import { LastResultMid, Mid } from "effect-open-protocol"
 *
 * declare const data: string
 *
 * const pushed = Mid.decode(LastResultMid.rev(1), data)
 * ```
 *
 * @category definitions
 * @since 0.0.0
 */
export const LastResultMid = Mid.define({
  tag: "LastResult",
  mid: 61,
  revisions: { 1: Mid.as(LastResult, LastResultBody) }
})

/**
 * MID 0062 revision 1: acknowledges a pushed result; nothing answers it.
 *
 * **Example** (Acknowledging a result)
 *
 * ```ts
 * import { AcknowledgeResultMid, DeviceConnection } from "effect-open-protocol"
 *
 * declare const connection: DeviceConnection.DeviceConnectionService
 *
 * // Nothing answers MID 0062, so this returns once the frame is sent.
 * const acknowledged = connection.request(AcknowledgeResultMid.rev(1), {})
 * ```
 *
 * @category definitions
 * @since 0.0.0
 */
export const AcknowledgeResultMid = Mid.request(
  Mid.define({ tag: "AcknowledgeResult", mid: 62, revisions: { 1: Mid.as(AcknowledgeResult, Field.layout([])) } }),
  { 1: Mid.noReply }
)

/**
 * MID 0063 revision 1: cancels the result subscription.
 *
 * **Example** (Unsubscribing by hand)
 *
 * ```ts
 * import { DeviceConnection, UnsubscribeResultsMid } from "effect-open-protocol"
 *
 * declare const connection: DeviceConnection.DeviceConnectionService
 *
 * const accepted = connection.request(UnsubscribeResultsMid.rev(1), {})
 * ```
 *
 * @category definitions
 * @since 0.0.0
 */
export const UnsubscribeResultsMid = Mid.request(
  Mid.define({ tag: "UnsubscribeResults", mid: 63, revisions: { 1: Mid.as(UnsubscribeResults, Field.layout([])) } }),
  { 1: commandAccepted }
)

/**
 * MID 0065 revision 1: a stored result returned by the controller.
 *
 * **Example** (Reading a stored result)
 *
 * ```ts
 * import { Mid, OldResultMid } from "effect-open-protocol"
 *
 * declare const data: string
 *
 * const stored = Mid.decode(OldResultMid.rev(1), data)
 * ```
 *
 * @category definitions
 * @since 0.0.0
 */
export const OldResultMid = Mid.define({
  tag: "OldResult",
  mid: 65,
  revisions: { 1: Mid.as(OldResult, OldResultBody) }
})

/**
 * MID 0064 revision 1: asks for a stored result, answered by MID 0065.
 *
 * **Example** (Fetching the latest stored result)
 *
 * ```ts
 * import { DeviceConnection, RequestOldResultMid, TighteningId } from "effect-open-protocol"
 *
 * declare const connection: DeviceConnection.DeviceConnectionService
 *
 * // The reply is typed as `OldResult`.
 * const latest = connection.request(RequestOldResultMid.rev(1), { tighteningId: TighteningId.make(0) })
 * ```
 *
 * @category definitions
 * @since 0.0.0
 */
export const RequestOldResultMid = Mid.request(
  Mid.define({
    tag: "RequestOldResult",
    mid: 64,
    revisions: {
      1: Mid.as(RequestOldResult, Field.layout([["tighteningId", Field.digits({ width: 10, schema: TighteningId })]]))
    }
  }),
  { 1: OldResultMid.rev(1) }
)

const keepAlive = Mid.define({ tag: "KeepAlive", mid: 9999, revisions: { 1: Mid.as(KeepAlive, Field.layout([])) } })

/**
 * MID 9999 revision 1: keep-alive, mirrored by the controller, so its reply is
 * its own revision.
 *
 * **Example** (Sending a keep-alive by hand)
 *
 * ```ts
 * import { DeviceConnection, KeepAliveMid } from "effect-open-protocol"
 *
 * declare const connection: DeviceConnection.DeviceConnectionService
 *
 * // The controller mirrors it; the reply is typed as `KeepAlive`.
 * const mirrored = connection.request(KeepAliveMid.rev(1), {})
 * ```
 *
 * @category definitions
 * @since 0.0.0
 */
export const KeepAliveMid = Mid.request(keepAlive, { 1: keepAlive.rev(1) })

type Modelled = Exclude<Message, UnknownMessage>

// One definition per modelled message, keyed by its tag: a message without a
// definition, or a definition under the wrong tag, fails to compile here.
const byTag = {
  CommunicationStart: CommunicationStartMid,
  CommunicationStartAccepted: CommunicationStartAcceptedMid,
  CommunicationStop: CommunicationStopMid,
  CommandError: CommandErrorMid,
  CommandAccepted: CommandAcceptedMid,
  SubscribeResults: SubscribeResultsMid,
  LastResult: LastResultMid,
  AcknowledgeResult: AcknowledgeResultMid,
  UnsubscribeResults: UnsubscribeResultsMid,
  RequestOldResult: RequestOldResultMid,
  OldResult: OldResultMid,
  KeepAlive: KeepAliveMid
} satisfies {
  readonly [Tag in Modelled["_tag"]]: Mid.AnyDefinition<Message> & { readonly tag: Tag }
}

const definitionOf = (message: Modelled): Mid.AnyDefinition<Message> => byTag[message._tag]

/**
 * The definition of every message this library models, one per MID. Each
 * decodes only to members of `Message`, which the element type checks.
 *
 * **Example** (Listing the MIDs the library speaks)
 *
 * ```ts
 * import * as A from "effect/Array"
 * import { builtIns } from "effect-open-protocol"
 *
 * console.log(A.map(builtIns, (definition) => definition.mid))
 * ```
 *
 * @category definitions
 * @since 0.0.0
 */
export const builtIns: ReadonlyArray<Mid.AnyDefinition<Message>> = R.values(byTag)

const byMid: R.ReadonlyRecord<string, Mid.AnyDefinition<Message>> = R.fromEntries(
  A.map(builtIns, (definition) => [`${definition.mid}`, definition] as const)
)

/**
 * Whether the library models a MID at all, whatever the revision.
 *
 * **Example** (Checking a MID)
 *
 * ```ts
 * import { isBuiltIn } from "effect-open-protocol"
 *
 * console.log(isBuiltIn(61), isBuiltIn(9100)) // true false
 * ```
 *
 * @category definitions
 * @since 0.0.0
 */
export const isBuiltIn = (number: number): boolean => R.has(byMid, `${number}`)

const unknownOf = (header: Header, data: string): Message =>
  new UnknownMessage({ mid: header.mid, revision: header.revision, data })

const fallBack = (header: Header, data: string, reason: string): Effect.Effect<Message> =>
  Effect.gen(function* () {
    yield* Effect.annotateLogs(Effect.logWarning("frame kept as an unknown message"), {
      mid: header.mid,
      revision: header.revision,
      reason
    })

    return unknownOf(header, data)
  })

const messageOf = (header: Header, data: string): Effect.Effect<Message> =>
  O.match(R.get(byMid, `${header.mid}`), {
    onNone: () => Effect.succeed(unknownOf(header, data)),
    onSome: (definition) =>
      O.match(definition.lookup(header.revision), {
        onNone: () => fallBack(header, data, `revision ${header.revision} is not defined`),
        onSome: (revision) =>
          Effect.catchTag(Mid.decode(revision, data), "PayloadDecodeError", (error) =>
            fallBack(header, data, error.reason)
          )
      })
  })

/**
 * Decodes one complete frame, terminator excluded, keeping its header and
 * data field next to the message.
 *
 * **Details**
 *
 * Only a malformed frame header fails. A MID the library does not model, a
 * revision it does not define, or a data field that does not decode all
 * become `UnknownMessage` (the last two with a warning), so one odd frame never
 * costs the session.
 *
 * **Example** (Decoding a keep-alive frame)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { decodeFrame } from "effect-open-protocol"
 *
 * const decoded = decodeFrame("00209999            ")
 *
 * Effect.runPromise(decoded).then((incoming) => console.log(incoming.header.mid, incoming.message._tag))
 * ```
 *
 * @category decoding
 * @since 0.0.0
 */
export const decodeFrame = (frame: string): Effect.Effect<Incoming, MalformedHeader | UnsupportedFeature> =>
  Effect.gen(function* () {
    const header = yield* Effect.fromResult(decodeHeader(frame))
    const data = Str.substring(headerLength, Str.length(frame))(frame)
    const message = yield* messageOf(header, data)

    return new Incoming({ header, data, message })
  })

/**
 * Decodes one complete frame, terminator excluded, into its message; see
 * {@link decodeFrame}.
 *
 * **Example** (Decoding a keep-alive frame)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { decodeMessage } from "effect-open-protocol"
 *
 * const decoded = decodeMessage("00209999            ")
 *
 * Effect.runPromise(decoded).then((message) => console.log(message._tag))
 * ```
 *
 * @category decoding
 * @since 0.0.0
 */
export const decodeMessage = (frame: string): Effect.Effect<Message, MalformedHeader | UnsupportedFeature> =>
  Effect.map(decodeFrame(frame), (incoming) => incoming.message)

const encodeModelled = (message: Modelled): string =>
  Result.getOrThrowWith(
    Result.gen(function* () {
      const definition = definitionOf(message)

      const revision = yield* Result.fromOption(
        definition.lookup(message.revision),
        () => new PayloadEncodeError({ mid: definition.mid, reason: `revision ${message.revision} is not defined` })
      )

      return yield* Mid.encode(revision, message)
    }),
    (error) => error
  )

/**
 * Renders a message as a complete frame, NUL terminator included.
 *
 * **Details**
 *
 * Each modelled message is written by its definition's revision, so decoding
 * `encodeMessage(m)` returns `m`. An `UnknownMessage` is written back
 * verbatim. A modelled message whose value does not fit its fields is a
 * defect: its class already refused anything its wire format cannot carry.
 * Code that sends a value it built itself should prefer `Mid.encode`, which
 * reports that as a `PayloadEncodeError`.
 *
 * **Example** (Encoding a subscribe request)
 *
 * ```ts
 * import { encodeMessage, SubscribeResults } from "effect-open-protocol"
 *
 * const frame = encodeMessage(new SubscribeResults())
 * ```
 *
 * @category encoding
 * @since 0.0.0
 */
export const encodeMessage: (message: Message) => string = Match.type<Message>().pipe(
  Match.tag("UnknownMessage", (message) => encodeFrame(message.mid, message.revision, message.data)),
  Match.orElse(encodeModelled)
)
