/**
 * The supported Open Protocol messages and their codec.
 *
 * Only the subset this library needs is modelled (see the packet design doc):
 * communication start/stop, generic accept/error, last tightening result
 * subscribe/data/acknowledge/unsubscribe, old result upload request/reply and
 * keep-alive. Any other MID decodes to `UnknownMessage` so an unexpected
 * message can be logged and dropped instead of breaking the connection.
 *
 * @since 0.0.0
 */
import { Match, pipe, Result } from "effect"
import * as A from "effect/Array"
import * as O from "effect/Option"
import * as Rec from "effect/Record"
import * as S from "effect/Schema"
import * as Str from "effect/String"
import { padNumber, padText, parseDigits } from "./Ascii.ts"
import { decodeHeader, encodeHeader, Header, headerLength, terminator } from "./Header.ts"
import { PayloadDecodeError, type ProtocolError } from "./ProtocolError.ts"
import {
  decodeLastResult,
  decodeOldResult,
  type DeviceId,
  encodeLastResult,
  encodeOldResult,
  TighteningId,
  TighteningResult
} from "./TighteningResult.ts"

/**
 * MID numbers this library speaks.
 *
 * @category models
 * @since 0.0.0
 */
export const Mid = S.Literals([1, 2, 3, 4, 5, 60, 61, 62, 63, 64, 65, 9999]).annotate({
  identifier: "Mid",
  description: "Open Protocol message identifiers supported by this library"
})

/**
 * @category models
 * @since 0.0.0
 */
export type Mid = typeof Mid.Type

/**
 * Enables the communication with a controller (MID 0001).
 *
 * @category models
 * @since 0.0.0
 */
export class CommunicationStart extends S.TaggedClass<CommunicationStart>()("CommunicationStart", {}, {
  description: "MID 0001, opens the session"
}) {}

/**
 * The controller accepted the session and describes itself (MID 0002).
 *
 * @category models
 * @since 0.0.0
 */
export class CommunicationStartAccepted
  extends S.TaggedClass<CommunicationStartAccepted>()("CommunicationStartAccepted", {
    cellId: S.Number.check(S.isInt(), S.isBetween({ minimum: 0, maximum: 9999 })),
    channelId: S.Number.check(S.isInt(), S.isBetween({ minimum: 0, maximum: 99 })),
    controllerName: S.String
  }, { description: "MID 0002, session accepted" })
{}

/**
 * Closes the communication (MID 0003).
 *
 * @category models
 * @since 0.0.0
 */
export class CommunicationStop extends S.TaggedClass<CommunicationStop>()("CommunicationStop", {}, {
  description: "MID 0003, closes the session"
}) {}

/**
 * The controller rejected the last command (MID 0004).
 *
 * @category models
 * @since 0.0.0
 */
export class CommandError extends S.TaggedClass<CommandError>()("CommandError", {
  mid: S.Number.check(S.isInt(), S.isBetween({ minimum: 0, maximum: 9999 })),
  code: S.Number.check(S.isInt(), S.isBetween({ minimum: 0, maximum: 99 }))
}, { description: "MID 0004, negative acknowledge carrying the failed MID" }) {}

/**
 * The controller accepted the last command (MID 0005).
 *
 * @category models
 * @since 0.0.0
 */
export class CommandAccepted extends S.TaggedClass<CommandAccepted>()("CommandAccepted", {
  mid: S.Number.check(S.isInt(), S.isBetween({ minimum: 0, maximum: 9999 }))
}, { description: "MID 0005, positive acknowledge carrying the accepted MID" }) {}

/**
 * Subscribes to tightening results in reliable mode (MID 0060).
 *
 * @category models
 * @since 0.0.0
 */
export class SubscribeResults extends S.TaggedClass<SubscribeResults>()("SubscribeResults", {}, {
  description: "MID 0060, subscribes to the last tightening result"
}) {}

/**
 * A pushed tightening result (MID 0061).
 *
 * @category models
 * @since 0.0.0
 */
export class LastResult extends S.TaggedClass<LastResult>()("LastResult", {
  result: TighteningResult
}, { description: "MID 0061, last tightening result" }) {}

/**
 * Acknowledges a pushed tightening result (MID 0062).
 *
 * @category models
 * @since 0.0.0
 */
export class AcknowledgeResult extends S.TaggedClass<AcknowledgeResult>()("AcknowledgeResult", {}, {
  description: "MID 0062, acknowledges the last tightening result"
}) {}

/**
 * Cancels the tightening result subscription (MID 0063).
 *
 * @category models
 * @since 0.0.0
 */
export class UnsubscribeResults extends S.TaggedClass<UnsubscribeResults>()("UnsubscribeResults", {}, {
  description: "MID 0063, unsubscribes from tightening results"
}) {}

/**
 * Requests a stored result by its tightening id; `0` asks for the latest one
 * (MID 0064).
 *
 * @category models
 * @since 0.0.0
 */
export class RequestOldResult extends S.TaggedClass<RequestOldResult>()("RequestOldResult", {
  tighteningId: TighteningId
}, { description: "MID 0064, uploads an old tightening result by id" }) {}

/**
 * A stored result returned by the controller (MID 0065).
 *
 * @category models
 * @since 0.0.0
 */
export class OldResult extends S.TaggedClass<OldResult>()("OldResult", {
  result: TighteningResult
}, { description: "MID 0065, old tightening result reply" }) {}

/**
 * Keep-alive, mirrored by the controller (MID 9999).
 *
 * @category models
 * @since 0.0.0
 */
export class KeepAlive extends S.TaggedClass<KeepAlive>()("KeepAlive", {}, {
  description: "MID 9999, keep-alive"
}) {}

/**
 * A well-formed frame carrying a MID this library does not model.
 *
 * @category models
 * @since 0.0.0
 */
export class UnknownMessage extends S.TaggedClass<UnknownMessage>()("UnknownMessage", {
  mid: S.Number.check(S.isInt(), S.isBetween({ minimum: 0, maximum: 9999 })),
  revision: S.Number.check(S.isInt(), S.isBetween({ minimum: 1, maximum: 999 })),
  data: S.String
}, { description: "A frame whose MID is outside the supported subset" }) {}

/**
 * Every message this library can decode.
 *
 * @category models
 * @since 0.0.0
 */
export type Message =
  | CommunicationStart
  | CommunicationStartAccepted
  | CommunicationStop
  | CommandError
  | CommandAccepted
  | SubscribeResults
  | LastResult
  | AcknowledgeResult
  | UnsubscribeResults
  | RequestOldResult
  | OldResult
  | KeepAlive
  | UnknownMessage

const numberAt = (
  mid: number,
  data: string,
  from: number,
  to: number,
  parameter: string
): Result.Result<number, PayloadDecodeError> =>
  pipe(
    Str.substring(from, to)(data),
    (raw) =>
      Str.length(raw) !== to - from
        ? Result.fail(new PayloadDecodeError({ mid, reason: `${parameter} is truncated` }))
        : parseDigits(raw, () => new PayloadDecodeError({ mid, reason: `${parameter} is not numeric` }))
  )

const decodeStartAccepted = (data: string): Result.Result<CommunicationStartAccepted, PayloadDecodeError> =>
  Result.gen(function* () {
    const cellId = yield* numberAt(2, data, 2, 6, "cellId")
    const channelId = yield* numberAt(2, data, 8, 10, "channelId")
    const controllerName = Str.substring(12, 37)(data)
    return new CommunicationStartAccepted({ cellId, channelId, controllerName: Str.trimEnd(controllerName) })
  })

const decodeCommandError = (data: string): Result.Result<CommandError, PayloadDecodeError> =>
  Result.gen(function* () {
    const mid = yield* numberAt(4, data, 0, 4, "mid")
    const code = yield* numberAt(4, data, 4, 6, "code")
    return new CommandError({ mid, code })
  })

const decodeRequestOldResult = (data: string): Result.Result<RequestOldResult, PayloadDecodeError> =>
  pipe(
    numberAt(64, data, 0, 10, "tighteningId"),
    Result.flatMap((value) =>
      pipe(
        S.decodeResult(TighteningId)(value),
        Result.mapError(() => new PayloadDecodeError({ mid: 64, reason: "tighteningId out of range" }))
      )
    ),
    Result.map((tighteningId) => new RequestOldResult({ tighteningId }))
  )

/** What one modelled message is on the wire: its MID, and how its data field decodes. */
interface Wire<M extends Message> {
  readonly mid: Mid
  readonly decode: (data: string, deviceId: DeviceId) => Result.Result<M, ProtocolError>
}

const wire = <M extends Message>(mid: Mid, decode: Wire<M>["decode"]): Wire<M> => ({ mid, decode })

/** A message whose data field carries nothing: the MID is the whole message. */
const empty = <M extends Message>(mid: Mid, message: () => M): Wire<M> => wire(mid, () => Result.succeed(message()))

/**
 * The wire format of every modelled message, keyed by tag.
 *
 * It is the one place a MID is written down: both directions read it, so a new
 * message is added here and nowhere else, and `satisfies` refuses an entry
 * whose decoder builds a different message than its key names.
 */
const wireFormat = {
  CommunicationStart: empty(1, () => new CommunicationStart()),
  CommunicationStartAccepted: wire(2, (data) => decodeStartAccepted(data)),
  CommunicationStop: empty(3, () => new CommunicationStop()),
  CommandError: wire(4, (data) => decodeCommandError(data)),
  CommandAccepted: wire(5, (data) =>
    pipe(
      numberAt(5, data, 0, 4, "mid"),
      Result.map((mid) => new CommandAccepted({ mid }))
    )),
  SubscribeResults: empty(60, () => new SubscribeResults()),
  LastResult: wire(61, (data, deviceId) =>
    pipe(
      decodeLastResult(deviceId, data),
      Result.map((result) => new LastResult({ result }))
    )),
  AcknowledgeResult: empty(62, () => new AcknowledgeResult()),
  UnsubscribeResults: empty(63, () => new UnsubscribeResults()),
  RequestOldResult: wire(64, (data) => decodeRequestOldResult(data)),
  OldResult: wire(65, (data, deviceId) =>
    pipe(
      decodeOldResult(deviceId, data),
      Result.map((result) => new OldResult({ result }))
    )),
  KeepAlive: empty(9999, () => new KeepAlive())
} satisfies { readonly [T in Exclude<Message, UnknownMessage>["_tag"]]: Wire<Extract<Message, { readonly _tag: T }>> }

const decoderFor: ReadonlyMap<number, Wire<Message>["decode"]> = new Map(
  A.map(Rec.values(wireFormat), (format) => [format.mid, format.decode] as const)
)

const decodeBody = (
  header: Header,
  data: string,
  deviceId: DeviceId
): Result.Result<Message, ProtocolError> =>
  O.match(O.fromNullishOr(decoderFor.get(header.mid)), {
    onNone: (): Result.Result<Message, ProtocolError> =>
      Result.succeed(new UnknownMessage({ mid: header.mid, revision: header.revision, data })),
    onSome: (decode) => decode(data, deviceId)
  })

/**
 * Decodes one complete frame, terminator excluded.
 *
 * `deviceId` is stamped onto decoded results; it never travels on the wire.
 *
 * **Example** (Decoding a keep-alive frame)
 *
 * ```ts
 * import { Result } from "effect"
 * import { decodeMessage, DeviceId } from "effect-open-protocol"
 *
 * const decoded = decodeMessage("00209999            ", DeviceId.makeUnsafe("tool-1"))
 *
 * console.log(Result.isSuccess(decoded))
 * ```
 *
 * @category decoding
 * @since 0.0.0
 */
export const decodeMessage = (
  frame: string,
  deviceId: DeviceId
): Result.Result<Message, ProtocolError> =>
  pipe(
    decodeHeader(frame),
    Result.flatMap((header) => decodeBody(header, Str.substring(headerLength, Str.length(frame))(frame), deviceId))
  )

const revisionOf = (message: Message): number => message._tag === "UnknownMessage" ? message.revision : 1

const midOf = (message: Message): number =>
  message._tag === "UnknownMessage" ? message.mid : wireFormat[message._tag].mid

const dataOf = (message: Message): string =>
  Match.value(message).pipe(
    Match.tag("CommunicationStartAccepted", (accepted) =>
      "01" + padNumber(accepted.cellId, 4) +
      "02" + padNumber(accepted.channelId, 2) +
      "03" + padText(accepted.controllerName, 25)),
    Match.tag("CommandError", (error) => padNumber(error.mid, 4) + padNumber(error.code, 2)),
    Match.tag("CommandAccepted", (accepted) => padNumber(accepted.mid, 4)),
    Match.tag("LastResult", (last) => encodeLastResult(last.result)),
    Match.tag("RequestOldResult", (request) => padNumber(request.tighteningId, 10)),
    Match.tag("OldResult", (old) => encodeOldResult(old.result)),
    Match.tag("UnknownMessage", (unknown) => unknown.data),
    Match.orElse(() => "")
  )

/**
 * Renders a message as a complete frame, NUL terminator included.
 *
 * The header length is computed from the rendered data field, so
 * `decodeMessage(encodeMessage(m), deviceId)` returns `m`.
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
export const encodeMessage = (message: Message): string => {
  const data = dataOf(message)
  const header = new Header({
    length: headerLength + Str.length(data),
    mid: midOf(message),
    revision: revisionOf(message),
    noAck: false,
    stationId: 1,
    spindleId: 1
  })
  return encodeHeader(header) + data + terminator
}
