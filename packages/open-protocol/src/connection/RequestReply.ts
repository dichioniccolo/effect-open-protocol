/**
 * Request/reply correlation for a protocol with no correlation id.
 *
 * Open Protocol answers a command either with the generic MID 0005 (accepted)
 * or 0004 (error), both carrying the MID they refer to, or with a dedicated
 * reply MID. It allows only one outstanding message at a time. So correlation
 * is a single slot guarded by a semaphore: a request takes the slot, sends, and
 * waits for the reply its definition declares. Everything else is unsolicited
 * traffic.
 *
 * @since 0.0.0
 */
import { Deferred, Effect, Predicate, Ref, Semaphore } from "effect"
import * as O from "effect/Option"
import type { Duration } from "effect"
import * as S from "effect/Schema"
import type { CommandAccepted, Message } from "../protocol/Messages.ts"
import * as Mid from "../protocol/Mid.ts"
import { PayloadEncodeError, type PayloadDecodeError } from "../protocol/ProtocolError.ts"
import type { DeviceId } from "../protocol/TighteningResult.ts"
import type { ConnectionLost } from "../transport/Transport.ts"
import { CommandRejected, RequestTimeout, UnexpectedRevision } from "./ConnectionError.ts"

/**
 * What a request revision resolves to: the declared reply revision's value,
 * the `0005` acknowledgement, or nothing.
 *
 * @category models
 * @since 0.0.0
 */
export type ReplyOf<Rev extends Mid.AnyRequestRevision> = Rev["reply"] extends Mid.AnyRevision
  ? Mid.Type<Rev["reply"]>
  : Rev["reply"] extends Mid.Accepted
    ? CommandAccepted
    : void

/**
 * How a reply can go wrong once the request is on the wire.
 *
 * @category models
 * @since 0.0.0
 */
export type ReplyError = CommandRejected | UnexpectedRevision | PayloadDecodeError

/**
 * Every way a request can fail.
 *
 * @category models
 * @since 0.0.0
 */
export type RequestError = RequestTimeout | ConnectionLost | PayloadEncodeError | ReplyError

type Answer = O.Option<Effect.Effect<unknown, ReplyError>>

// A plain boolean on purpose: the reply's type is unknown here, and a type
// guard would narrow `message` to `never` on the other branches.
const isValueOf = (reply: Mid.AnyRevision, message: Message): boolean => S.is(S.toType(reply.codec))(message)

const rejected = (requestMid: number, message: Message): Answer =>
  Predicate.isTagged(message, "CommandError") && message.mid === requestMid
    ? O.some(Effect.fail(new CommandRejected({ mid: requestMid, code: message.code })))
    : O.none()

const dedicated = (reply: Mid.AnyRevision, deviceId: DeviceId, message: Message): Answer =>
  isValueOf(reply, message)
    ? O.some(Effect.succeed(message))
    : Predicate.isTagged(message, "UnknownMessage") && message.mid === reply.mid
      ? O.some(
          message.revision === reply.revision
            ? Mid.decode(reply, message.data, deviceId)
            : Effect.fail(
                new UnexpectedRevision({ mid: reply.mid, expected: reply.revision, received: message.revision })
              )
        )
      : Predicate.isTagged(message, reply.tag)
        ? O.some(
            Effect.fail(
              new UnexpectedRevision({ mid: reply.mid, expected: reply.revision, received: message.revision })
            )
          )
        : O.none()

const answerOf =
  (request: Mid.AnyRequestRevision, deviceId: DeviceId) =>
  (message: Message): Answer =>
    O.orElse(rejected(request.mid, message), () =>
      Predicate.isTagged(request.reply, "Accepted")
        ? Predicate.isTagged(message, "CommandAccepted") && message.mid === request.mid
          ? O.some(Effect.succeed(message))
          : O.none()
        : Predicate.isTagged(request.reply, "NoReply")
          ? O.none()
          : dedicated(request.reply, deviceId, message)
    )

const frameOf = <Rev extends Mid.AnyRequestRevision>(
  revision: Rev,
  payload: Mid.Payload<Rev>
): Effect.Effect<string, PayloadEncodeError> =>
  Effect.gen(function* () {
    const value = yield* Effect.mapError(
      revision.codec.makeEffect(payload),
      (issue) => new PayloadEncodeError({ mid: revision.mid, reason: `${issue}` })
    )

    return yield* Effect.fromResult(Mid.encode(revision, value))
  })

interface Pending {
  readonly answer: (message: Message) => Answer
  readonly deferred: Deferred.Deferred<unknown, ReplyError | ConnectionLost>
}

/**
 * The correlation slot of one session.
 *
 * @category models
 * @since 0.0.0
 */
export interface RequestReply {
  /**
   * Sends a value of a request revision and waits for the reply that
   * revision declares, typed accordingly.
   */
  readonly request: <Rev extends Mid.AnyRequestRevision>(
    revision: Rev,
    payload: Mid.Payload<Rev>,
    timeout?: Duration.Duration | undefined
  ) => Effect.Effect<ReplyOf<Rev>, RequestError>
  /** Hands an incoming message to the request in flight; `true` if it was its reply. */
  readonly offer: (message: Message) => Effect.Effect<boolean>
  /** Fails the request in flight, if any. */
  readonly interruptAll: (error: ConnectionLost) => Effect.Effect<void>
}

/**
 * Builds the correlation slot for one session.
 *
 * **Example** (A slot over a session's send function)
 *
 * ```ts
 * import { Duration, Effect } from "effect"
 * import { DeviceId, RequestReply } from "effect-open-protocol"
 *
 * const replies = RequestReply.make({
 *   send: () => Effect.void,
 *   responseTimeout: Duration.seconds(5),
 *   deviceId: DeviceId.make("tool-1")
 * })
 * ```
 *
 * @category constructors
 * @since 0.0.0
 */
export const make = Effect.fnUntraced(function* (options: {
  readonly send: (frame: string) => Effect.Effect<void, ConnectionLost>
  readonly responseTimeout: Duration.Duration
  readonly deviceId: DeviceId
}) {
  const slot = yield* Ref.make(O.none<Pending>())
  const gate = yield* Semaphore.make(1)

  const exchange = (revision: Mid.AnyRequestRevision, frame: string, timeout: Duration.Duration) =>
    gate.withPermits(1)(
      Effect.scoped(
        Effect.gen(function* () {
          const deferred = yield* Deferred.make<unknown, ReplyError | ConnectionLost>()
          yield* Ref.set(slot, O.some({ answer: answerOf(revision, options.deviceId), deferred }))
          yield* Effect.addFinalizer(() => Ref.set(slot, O.none()))
          yield* options.send(frame)

          return yield* Effect.timeoutOrElse(Deferred.await(deferred), {
            duration: timeout,
            orElse: () => Effect.fail(new RequestTimeout({ mid: revision.mid }))
          })
        })
      )
    )

  const request = <Rev extends Mid.AnyRequestRevision>(
    revision: Rev,
    payload: Mid.Payload<Rev>,
    timeout?: Duration.Duration | undefined
  ): Effect.Effect<ReplyOf<Rev>, RequestError> =>
    Effect.gen(function* () {
      const frame = yield* frameOf(revision, payload)

      const reply = Predicate.isTagged(revision.reply, "NoReply")
        ? yield* gate.withPermits(1)(options.send(frame))
        : yield* exchange(revision, frame, timeout ?? options.responseTimeout)

      // SAFETY: `answerOf` resolves the deferred only with what `revision.reply`
      // declares: a value of the reply revision (checked by its schema or decoded
      // by its codec), the `0005` acknowledgement, or nothing for `NoReply`.
      // That is `ReplyOf<Rev>`; TypeScript cannot follow the runtime branch.
      return reply as ReplyOf<Rev>
    })

  const offer = (message: Message): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      const pending = yield* Ref.get(slot)

      const answered = O.gen(function* () {
        const current = yield* pending
        const reply = yield* current.answer(message)

        return { current, reply }
      })

      if (O.isNone(answered)) {
        return false
      }

      const exit = yield* Effect.exit(answered.value.reply)
      yield* Deferred.done(answered.value.current.deferred, exit)

      return true
    })

  const interruptAll = (error: ConnectionLost): Effect.Effect<void> =>
    Effect.gen(function* () {
      const pending = yield* Ref.get(slot)
      yield* O.match(pending, {
        onNone: () => Effect.void,
        onSome: (current) => Effect.asVoid(Deferred.fail(current.deferred, error))
      })
    })

  return { request, offer, interruptAll } satisfies RequestReply
})
