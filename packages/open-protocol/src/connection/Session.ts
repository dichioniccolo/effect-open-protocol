/**
 * One live session with a controller: the socket, the correlation slot, and
 * the two loops that run for as long as both are healthy.
 *
 * A session is created per connection attempt and dies with it. Keeping it
 * apart from the supervisor means the code that reads frames and the code that
 * decides when to reconnect never have to be read together.
 *
 * @since 0.0.0
 */
import { Duration, Effect, Ref, Stream } from "effect"
import { frames } from "../protocol/Framer.ts"
import { decodeFrame, type Incoming, KeepAliveMid, type Message } from "../protocol/Messages.ts"
import * as Mid from "../protocol/Mid.ts"
import type { PayloadEncodeError } from "../protocol/ProtocolError.ts"
import { ConnectionLost, type Duplex } from "../transport/Transport.ts"
import { orLost, type RequestReply } from "./RequestReply.ts"

/**
 * The socket and the correlation slot that belong to one connection attempt.
 *
 * @category models
 * @since 0.0.0
 */
export interface Session {
  readonly duplex: Duplex
  readonly replies: RequestReply
}

const encoder = new TextEncoder()

/**
 * Writes an encoded frame straight to the socket, without expecting a reply.
 *
 * **Example** (Writing a keep-alive frame)
 *
 * ```ts
 * import { encodeFrame, sendFrame, type Duplex } from "effect-open-protocol"
 *
 * declare const duplex: Duplex
 *
 * const sent = sendFrame(duplex, encodeFrame(9999, 1, ""))
 * ```
 *
 * @category sending
 * @since 0.0.0
 */
export const sendFrame = (duplex: Duplex, frame: string): Effect.Effect<void, ConnectionLost> =>
  duplex.send(encoder.encode(frame))

/**
 * Builds a value of a revision and writes its frame straight to the socket,
 * without waiting for anything and without taking the correlation slot.
 *
 * **Example** (Acknowledging a result without waiting)
 *
 * ```ts
 * import { AcknowledgeResultMid, sendPayload, type Duplex } from "effect-open-protocol"
 *
 * declare const duplex: Duplex
 *
 * const sent = sendPayload(duplex, AcknowledgeResultMid.rev(1), {})
 * ```
 *
 * @category sending
 * @since 0.0.0
 */
export const sendPayload = <Rev extends Mid.AnyRevision>(
  duplex: Duplex,
  revision: Rev,
  payload: Mid.Payload<Rev>
): Effect.Effect<void, ConnectionLost | PayloadEncodeError> =>
  Effect.gen(function* () {
    const frame = yield* Mid.frame(revision, payload)

    yield* sendFrame(duplex, frame)
  })

const protocolLost = (tag: string): Effect.Effect<never, ConnectionLost> =>
  Effect.fail(new ConnectionLost({ reason: `protocol error: ${tag}` }))

/**
 * Reads frames until the controller goes away. Each frame is offered to the
 * request in flight first, then to `subscribed`; a message neither takes goes
 * to `onUnsolicited`.
 *
 * It never succeeds: a stream that ends means the peer closed the connection.
 *
 * @category loops
 * @since 0.0.0
 */
export const readLoop = (
  session: Session,
  subscribed: (incoming: Incoming) => Effect.Effect<boolean>,
  onUnsolicited: (message: Message) => Effect.Effect<void>
): Effect.Effect<never, ConnectionLost> =>
  Effect.gen(function* () {
    const onFrame = Effect.fnUntraced(function* (frame: string) {
      const incoming = yield* decodeFrame(frame)
      // A pushed frame can arrive while a request waits for its reply, so the
      // reply is recognised first and everything else falls through.
      const consumed = (yield* session.replies.offer(incoming)) || (yield* subscribed(incoming))

      if (!consumed) {
        yield* onUnsolicited(incoming.message)
      }
    })

    yield* Effect.catchTags(Stream.runForEach(frames(session.duplex.incoming), onFrame), {
      MalformedHeader: (error) => protocolLost(error._tag),
      InvalidLength: (error) => protocolLost(error._tag),
      MissingTerminator: (error) => protocolLost(error._tag),
      UnsupportedFeature: (error) => protocolLost(error._tag)
    })

    return yield* new ConnectionLost({ reason: "the controller closed the connection" })
  })

/**
 * Sends MID 9999 whenever the link has been idle for `interval`, and fails the
 * session when the controller stops mirroring it.
 *
 * @category loops
 * @since 0.0.0
 */
export const keepAliveLoop = (
  session: Session,
  lastSent: Ref.Ref<number>,
  interval: Duration.Duration
): Effect.Effect<never, ConnectionLost> =>
  Effect.forever(
    Effect.gen(function* () {
      yield* Effect.sleep(interval)

      const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis)
      const sent = yield* Ref.get(lastSent)

      // The link spoke recently enough on its own; a keep-alive would be noise.
      if (Duration.toMillis(interval) > now - sent) {
        return
      }

      yield* orLost("keep-alive")(session.replies.request(KeepAliveMid.rev(1), {}))
      yield* Ref.set(lastSent, now)
    })
  )
