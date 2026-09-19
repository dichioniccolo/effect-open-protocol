/**
 * The exchange that turns an open socket into a usable session.
 *
 * Both steps are pure protocol conversation: they say what is sent, what
 * answer counts, and what a refusal means for the session. The supervisor next
 * door decides when they run and what to do when they fail, so neither file
 * has to be read to understand the other.
 *
 * @since 0.0.0
 */
import { Effect } from "effect"
import { CommunicationStartMid, SubscribeResultsMid } from "../protocol/Messages.ts"
import type * as Mid from "../protocol/Mid.ts"
import type { ConnectionLost } from "../transport/Transport.ts"
import { type CommandRejected, HandshakeRejected } from "./ConnectionError.ts"
import { lostOn, orLost } from "./RequestReply.ts"
import type { Session } from "./Session.ts"

/**
 * Opens the session with MID 0001 and returns the name the controller
 * answered with.
 *
 * A refusal is the controller's own verdict (code 96: another client already
 * holds it), so it stays a `HandshakeRejected`; silence is a dead socket.
 *
 * @category handshake
 * @since 0.0.0
 */
export const startCommunication = (session: Session): Effect.Effect<string, ConnectionLost | HandshakeRejected> =>
  Effect.gen(function* () {
    const accepted = yield* Effect.catchTags(session.replies.request(CommunicationStartMid.rev(1), {}), {
      ...lostOn("handshake"),
      CommandRejected: (rejected) => Effect.fail(new HandshakeRejected({ code: rejected.code }))
    })

    return accepted.controllerName
  })

/**
 * Subscribes to tightening results with MID 0060.
 *
 * A session that cannot subscribe delivers nothing, so either failure ends the
 * attempt and the supervisor reconnects.
 *
 * @category handshake
 * @since 0.0.0
 */
export const subscribeResults = (session: Session): Effect.Effect<void, ConnectionLost> =>
  Effect.asVoid(orLost("subscribe")(session.replies.request(SubscribeResultsMid.rev(1), {})))

/**
 * Sends a subscription's subscribe MID and waits for the controller to accept
 * it.
 *
 * **Details**
 *
 * A refusal is the controller's answer and stays a `CommandRejected`, so the
 * caller decides what it means; anything else (silence, a garbled reply) is a
 * session that cannot go on.
 *
 * **Example** (Subscribing to results on a session)
 *
 * ```ts
 * import { LastResults, subscribeTo, type Session } from "effect-open-protocol"
 *
 * const subscribed = (session: Session) => subscribeTo(session, LastResults.rev(1))
 * ```
 *
 * @category handshake
 * @since 0.0.0
 */
export const subscribeTo = (
  session: Session,
  subscription: Mid.AnySubscription
): Effect.Effect<void, ConnectionLost | CommandRejected> =>
  Effect.asVoid(
    Effect.catchTags(session.replies.request(subscription.subscribe, {}), {
      ...lostOn("subscribe"),
      CommandRejected: (rejected: CommandRejected) => Effect.fail(rejected)
    })
  )
