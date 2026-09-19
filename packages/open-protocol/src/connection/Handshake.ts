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
import { CommunicationStartMid, SubscribeResultsMid } from "../protocol/Messages.ts"
import { ConnectionLost } from "../transport/Transport.ts"
import { HandshakeRejected } from "./ConnectionError.ts"
import type { Session } from "./Session.ts"

const lost = (step: string, tag: string): Effect.Effect<never, ConnectionLost> =>
  Effect.fail(new ConnectionLost({ reason: `${step} failed: ${tag}` }))

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
export const startCommunication = (session: Session): Effect.Effect<string, ConnectionLost | HandshakeRejected> =>
  pipe(
    session.replies.request(CommunicationStartMid.rev(1), {}),
    Effect.map((accepted) => accepted.controllerName),
    Effect.catchTags({
      CommandRejected: (rejected) => Effect.fail(new HandshakeRejected({ code: rejected.code })),
      RequestTimeout: () => Effect.fail(new ConnectionLost({ reason: "handshake timed out" })),
      UnexpectedRevision: (error) => lost("handshake", error._tag),
      PayloadDecodeError: (error) => lost("handshake", error._tag),
      PayloadEncodeError: (error) => lost("handshake", error._tag)
    })
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
    session.replies.request(SubscribeResultsMid.rev(1), {}),
    Effect.asVoid,
    Effect.catchTags({
      CommandRejected: (rejected) =>
        Effect.fail(new ConnectionLost({ reason: `subscription refused with code ${rejected.code}` })),
      RequestTimeout: () => Effect.fail(new ConnectionLost({ reason: "subscribe timed out" })),
      UnexpectedRevision: (error) => lost("subscribe", error._tag),
      PayloadDecodeError: (error) => lost("subscribe", error._tag),
      PayloadEncodeError: (error) => lost("subscribe", error._tag)
    })
  )
