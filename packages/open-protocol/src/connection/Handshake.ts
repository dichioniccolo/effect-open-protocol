/**
 * The exchange that turns an open socket into a usable session.
 *
 * The handshake is pure protocol conversation: it says what is sent, what
 * answer counts, and what a refusal means for the session. The supervisor next
 * door decides when it runs and what to do when it fails, so neither file has
 * to be read to understand the other.
 *
 * @since 0.0.0
 */
import { Effect } from "effect"
import { CommunicationStartMid } from "../protocol/Messages.ts"
import type { ConnectionLost } from "../transport/Transport.ts"
import { HandshakeRejected } from "./ConnectionError.ts"
import { lostOn } from "./RequestReply.ts"
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
