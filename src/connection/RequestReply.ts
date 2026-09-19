/**
 * Request/reply correlation for a protocol with no correlation id.
 *
 * Open Protocol answers a command with a generic MID 0005 (accepted) or MID
 * 0004 (error) carrying the MID they refer to, and the specification allows
 * only one outstanding message at a time. So correlation is a single slot
 * guarded by a semaphore: a request takes the slot, sends, and waits for a
 * reply that matches its expectation. Everything else is unsolicited traffic.
 *
 * @since 0.0.0
 */
import { Deferred, Effect, Match, pipe, Predicate, Ref, Semaphore } from "effect"
import * as Context from "effect/Context"
import * as O from "effect/Option"
import type { Duration } from "effect"
import type { Message } from "../protocol/Messages.ts"
import type { ConnectionLost } from "../transport/Transport.ts"
import { CommandRejected, RequestTimeout } from "./ConnectionError.ts"

/**
 * Decides whether an incoming message answers the request in flight.
 *
 * `None` means "not my reply, keep looking"; a failure means the controller
 * refused the command.
 *
 * @category models
 * @since 0.0.0
 */
export type Expectation = (message: Message) => O.Option<Effect.Effect<Message, CommandRejected>>

/**
 * Matches the generic accept/error pair for a command, plus an optional direct
 * reply message.
 *
 * **Example** (Waiting for the subscribe acknowledgement)
 *
 * ```ts
 * import { expectReply } from "effect-open-protocol"
 *
 * const expectation = expectReply(60)
 * ```
 *
 * @category constructors
 * @since 0.0.0
 */
export const expectReply =
  (mid: number, direct?: Message["_tag"] | undefined): Expectation =>
  (message) =>
    Match.value(message).pipe(
      Match.tag("CommandAccepted", (accepted) => (accepted.mid === mid ? O.some(Effect.succeed(message)) : O.none())),
      Match.tag("CommandError", (error) =>
        error.mid === mid ? O.some(Effect.fail(new CommandRejected({ mid, code: error.code }))) : O.none()
      ),
      Match.orElse(() =>
        direct !== undefined && Predicate.isTagged(message, direct) ? O.some(Effect.succeed(message)) : O.none()
      )
    )

interface Pending {
  readonly mid: number
  readonly expectation: Expectation
  readonly deferred: Deferred.Deferred<Message, CommandRejected | ConnectionLost>
}

/**
 * A correlation slot bound to one live session.
 *
 * @category models
 * @since 0.0.0
 */
export interface RequestReplyService {
  /**
   * Sends a message and waits for the reply that matches `expectation`,
   * queueing behind any request already in flight.
   */
  readonly request: (
    message: Message,
    mid: number,
    expectation: Expectation,
    timeout?: Duration.Duration | undefined
  ) => Effect.Effect<Message, RequestTimeout | CommandRejected | ConnectionLost>
  /**
   * Offers an incoming message to the pending request. Returns `true` when it
   * was consumed as a reply, `false` when it is unsolicited traffic.
   */
  readonly offer: (message: Message) => Effect.Effect<boolean>
  /** Fails every waiter, used when the session dies. */
  readonly interruptAll: (error: ConnectionLost) => Effect.Effect<void>
}

/** Builds a correlation slot over a send function. */
export const make = Effect.fnUntraced(function* (options: {
  readonly send: (message: Message) => Effect.Effect<void, ConnectionLost>
  readonly responseTimeout: Duration.Duration
}) {
  const slot = yield* Ref.make(O.none<Pending>())
  const gate = yield* Semaphore.make(1)

  const request = (
    message: Message,
    mid: number,
    expectation: Expectation,
    timeout?: Duration.Duration | undefined
  ): Effect.Effect<Message, RequestTimeout | CommandRejected | ConnectionLost> =>
    gate.withPermits(1)(
      Effect.gen(function* () {
        const deferred = yield* Deferred.make<Message, CommandRejected | ConnectionLost>()
        yield* Ref.set(slot, O.some({ mid, expectation, deferred }))
        yield* Effect.addFinalizer(() => Ref.set(slot, O.none()))
        yield* options.send(message)

        return yield* pipe(
          Deferred.await(deferred),
          Effect.timeoutOrElse({
            duration: timeout ?? options.responseTimeout,
            orElse: () => Effect.fail(new RequestTimeout({ mid }))
          })
        )
      }).pipe(Effect.scoped)
    )

  const offer = (message: Message): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      const pending = yield* Ref.get(slot)

      return yield* O.match(pending, {
        onNone: () => Effect.succeed(false),
        onSome: (current) =>
          O.match(current.expectation(message), {
            onNone: () => Effect.succeed(false),
            onSome: (reply) =>
              pipe(
                Effect.exit(reply),
                Effect.flatMap((exit) => Deferred.done(current.deferred, exit)),
                Effect.as(true)
              )
          })
      })
    })

  const interruptAll = (error: ConnectionLost): Effect.Effect<void> =>
    Effect.gen(function* () {
      const pending = yield* Ref.get(slot)
      yield* O.match(pending, {
        onNone: () => Effect.void,
        onSome: (current) => Effect.asVoid(Deferred.fail(current.deferred, error))
      })
    })

  return { request, offer, interruptAll } satisfies RequestReplyService
})

/**
 * The correlation slot of one live session.
 *
 * Every attempt builds its own over the socket it just opened, so the slot
 * dies with the session it belongs to: `RequestReply.make` is the way in, and
 * the `Session` carries the result to whoever sends on it.
 *
 * @category services
 * @since 0.0.0
 */
export class RequestReply extends Context.Service<RequestReply, RequestReplyService>()(
  "effect-open-protocol/RequestReply"
) {}
