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
import { Deferred, Effect, Ref, Semaphore } from "effect"
import * as O from "effect/Option"
import type { Duration } from "effect"
import { type Incoming, rejectionOf } from "../protocol/Messages.ts"
import * as Mid from "../protocol/Mid.ts"
import type { PayloadEncodeError } from "../protocol/ProtocolError.ts"
import { ConnectionLost } from "../transport/Transport.ts"
import { CommandRejected, RequestTimeout } from "./ConnectionError.ts"

/**
 * Every way a request can fail.
 *
 * @category models
 * @since 0.0.0
 */
export type RequestError = RequestTimeout | ConnectionLost | PayloadEncodeError | CommandRejected | Mid.ReplyError

/**
 * A request revision whose reply resolves to `A`.
 *
 * @category models
 * @since 0.0.0
 */
export type Expecting<Rev extends Mid.AnyRequestRevision, A> = Rev & { readonly reply: Mid.Reply<A> }

const rejected = (request: number, incoming: Incoming): O.Option<Effect.Effect<never, CommandRejected>> =>
  O.map(rejectionOf(request, incoming), (error) => Effect.fail(new CommandRejected({ mid: request, code: error.code })))

/** The request in flight: settles itself from its reply, or fails with the session. */
interface Pending {
  readonly settle: (incoming: Incoming) => O.Option<Effect.Effect<void>>
  readonly fail: (error: ConnectionLost) => Effect.Effect<void>
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
  readonly request: <Rev extends Mid.AnyRequestRevision, A>(
    revision: Expecting<Rev, A>,
    payload: Mid.Payload<Rev>,
    timeout?: Duration.Duration | undefined
  ) => Effect.Effect<A, RequestError>
  /** Hands an incoming frame to the request in flight; `true` if it was its reply. */
  readonly offer: (incoming: Incoming) => Effect.Effect<boolean>
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
 * import { RequestReply } from "effect-open-protocol"
 *
 * const replies = RequestReply.make({
 *   send: () => Effect.void,
 *   responseTimeout: Duration.seconds(5)
 * })
 * ```
 *
 * @category constructors
 * @since 0.0.0
 */
export const make = Effect.fnUntraced(function* (options: {
  readonly send: (frame: string) => Effect.Effect<void, ConnectionLost>
  readonly responseTimeout: Duration.Duration
}) {
  const slot = yield* Ref.make(O.none<Pending>())
  const gate = yield* Semaphore.make(1)

  const exchange = <A>(mid: number, reply: Mid.Reply<A>, frame: string, timeout: Duration.Duration) =>
    Effect.scoped(
      Effect.gen(function* () {
        const deferred = yield* Deferred.make<A, CommandRejected | Mid.ReplyError | ConnectionLost>()

        const pending: Pending = {
          settle: (incoming) =>
            O.map(
              O.orElse(rejected(mid, incoming), () => reply.answer(mid, incoming)),
              (answer) => Effect.asVoid(Deferred.complete(deferred, answer))
            ),
          fail: (error) => Effect.asVoid(Deferred.fail(deferred, error))
        }

        yield* Ref.set(slot, O.some(pending))
        yield* Effect.addFinalizer(() => Ref.set(slot, O.none()))
        yield* options.send(frame)

        return yield* Effect.timeoutOrElse(Deferred.await(deferred), {
          duration: timeout,
          orElse: () => Effect.fail(new RequestTimeout({ mid }))
        })
      })
    )

  const request = <Rev extends Mid.AnyRequestRevision, A>(
    revision: Expecting<Rev, A>,
    payload: Mid.Payload<Rev>,
    timeout?: Duration.Duration | undefined
  ): Effect.Effect<A, RequestError> =>
    Effect.gen(function* () {
      const frame = yield* Mid.frame(revision, payload)
      const reply: Mid.Reply<A> = revision.reply

      return yield* gate.withPermits(1)(
        O.match(reply.settled, {
          onSome: (value) => Effect.as(options.send(frame), value),
          onNone: () => exchange(revision.mid, reply, frame, timeout ?? options.responseTimeout)
        })
      )
    })

  const offer = (incoming: Incoming): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      const pending = yield* Ref.get(slot)

      return yield* O.match(
        O.flatMap(pending, (current) => current.settle(incoming)),
        {
          onNone: () => Effect.succeed(false),
          onSome: (settle) => Effect.as(settle, true)
        }
      )
    })

  const interruptAll = (error: ConnectionLost): Effect.Effect<void> =>
    Effect.gen(function* () {
      const pending = yield* Ref.get(slot)
      yield* O.match(pending, { onNone: () => Effect.void, onSome: (current) => current.fail(error) })
    })

  return { request, offer, interruptAll } satisfies RequestReply
})

/**
 * `catchTags` handlers that turn every way a request can fail into the
 * `ConnectionLost` of a session step. Spread them and override a tag to keep
 * one failure distinct, as the handshake does with a refusal.
 *
 * **Example** (Keeping a refusal, losing the session on anything else)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { CommunicationStartMid, HandshakeRejected, RequestReply } from "effect-open-protocol"
 *
 * declare const replies: RequestReply.RequestReply
 *
 * const accepted = Effect.catchTags(replies.request(CommunicationStartMid.rev(1), {}), {
 *   ...RequestReply.lostOn("handshake"),
 *   CommandRejected: (rejected) => Effect.fail(new HandshakeRejected({ code: rejected.code }))
 * })
 * ```
 *
 * @category combinators
 * @since 0.0.0
 */
export const lostOn = (step: string) => {
  const lost = (reason: string): Effect.Effect<never, ConnectionLost> =>
    Effect.fail(new ConnectionLost({ reason: `${step} ${reason}` }))

  const failed = (error: Mid.ReplyError | PayloadEncodeError) => lost(`failed: ${error._tag}`)

  return {
    RequestTimeout: () => lost("timed out"),
    CommandRejected: (error: CommandRejected) => lost(`refused with code ${error.code}`),
    UnexpectedRevision: failed,
    PayloadDecodeError: failed,
    PayloadEncodeError: failed
  }
}

/**
 * Turns every way a request can fail into the `ConnectionLost` of a session
 * step, for the library's own requests: whatever goes wrong with them, the
 * session cannot go on.
 *
 * **Example** (Subscribing, or losing the session)
 *
 * ```ts
 * import { RequestReply, SubscribeResultsMid } from "effect-open-protocol"
 *
 * declare const replies: RequestReply.RequestReply
 *
 * const subscribed = RequestReply.orLost("subscribe")(replies.request(SubscribeResultsMid.rev(1), {}))
 * ```
 *
 * @category combinators
 * @since 0.0.0
 */
export const orLost =
  (step: string) =>
  <A, R>(self: Effect.Effect<A, RequestError, R>): Effect.Effect<A, ConnectionLost, R> =>
    Effect.catchTags(self, lostOn(step))
