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
import { Effect, pipe } from "effect"
import { CommunicationStart, SubscribeResults } from "../protocol/Messages.ts"
import { ConnectionLost } from "../transport/Transport.ts"
import { HandshakeRejected } from "./ConnectionError.ts"
import { expectReply } from "./RequestReply.ts"
import type { Session } from "./Session.ts"

/**
 * Opens the session with MID 0001 and returns the name the controller
 * answered with, or the empty string when it named itself in no reply of ours.
 *
 * A refusal is the controller's own verdict (code 96: another client already
 * holds it), so it stays a `HandshakeRejected`; silence is a dead socket.
 *
 * @category handshake
 * @since 0.0.0
 */
export const startCommunication = (
  session: Session
): Effect.Effect<string, ConnectionLost | HandshakeRejected> =>
  pipe(
    session.replies.request(new CommunicationStart(), 1, expectReply(1, "CommunicationStartAccepted")),
    Effect.map((accepted) => accepted._tag === "CommunicationStartAccepted" ? accepted.controllerName : ""),
    Effect.catchTag("CommandRejected", (rejected) => Effect.fail(new HandshakeRejected({ code: rejected.code }))),
    Effect.catchTag("RequestTimeout", () => Effect.fail(new ConnectionLost({ reason: "handshake timed out" })))
  )

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
  pipe(
    session.replies.request(new SubscribeResults(), 60, expectReply(60)),
    Effect.asVoid,
    Effect.catchTag("CommandRejected", (rejected) =>
      Effect.fail(new ConnectionLost({ reason: `subscription refused with code ${rejected.code}` }))),
    Effect.catchTag("RequestTimeout", () => Effect.fail(new ConnectionLost({ reason: "subscribe timed out" })))
  )
