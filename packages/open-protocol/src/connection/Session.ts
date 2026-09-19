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
import { decodeMessage, encodeMessage, KeepAliveMid, type Message } from "../protocol/Messages.ts"
import type { DeviceId } from "../protocol/TighteningResult.ts"
import { ConnectionLost, type Duplex } from "../transport/Transport.ts"
import type { RequestReply } from "./RequestReply.ts"

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
 * import { encodeMessage, KeepAlive, sendFrame, type Duplex } from "effect-open-protocol"
 *
 * declare const duplex: Duplex
 *
 * const sent = sendFrame(duplex, encodeMessage(new KeepAlive()))
 * ```
 *
 * @category sending
 * @since 0.0.0
 */
export const sendFrame = (duplex: Duplex, frame: string): Effect.Effect<void, ConnectionLost> =>
  duplex.send(encoder.encode(frame))

/**
 * Sends one modelled message, without waiting for anything.
 *
 * **Example** (Acknowledging a result without waiting)
 *
 * ```ts
 * import { AcknowledgeResult, sendRaw, type Duplex } from "effect-open-protocol"
 *
 * declare const duplex: Duplex
 *
 * const sent = sendRaw(duplex, new AcknowledgeResult())
 * ```
 *
 * @category sending
 * @since 0.0.0
 */
export const sendRaw = (duplex: Duplex, message: Message): Effect.Effect<void, ConnectionLost> =>
  sendFrame(duplex, encodeMessage(message))

const protocolLost = (tag: string): Effect.Effect<never, ConnectionLost> =>
  Effect.fail(new ConnectionLost({ reason: `protocol error: ${tag}` }))

/**
 * Reads frames until the controller goes away, handing every message that is
 * not a reply to `onUnsolicited`.
 *
 * It never succeeds: a stream that ends means the peer closed the connection.
 *
 * @category loops
 * @since 0.0.0
 */
export const readLoop = (
  session: Session,
  deviceId: DeviceId,
  onUnsolicited: (message: Message) => Effect.Effect<void>
): Effect.Effect<never, ConnectionLost> =>
  frames(session.duplex.incoming).pipe(
    Stream.runForEach(
      Effect.fnUntraced(function* (frame: string) {
        const message = yield* decodeMessage(frame, deviceId)
        const consumed = yield* session.replies.offer(message)

        if (!consumed) {
          yield* onUnsolicited(message)
        }
      })
    ),
    Effect.catchTags({
      MalformedHeader: (error) => protocolLost(error._tag),
      InvalidLength: (error) => protocolLost(error._tag),
      MissingTerminator: (error) => protocolLost(error._tag),
      UnsupportedFeature: (error) => protocolLost(error._tag)
    }),
    Effect.andThen(Effect.fail(new ConnectionLost({ reason: "the controller closed the connection" })))
  )

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
  Effect.gen(function* () {
    yield* Effect.sleep(interval)

    const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis)
    const sent = yield* Ref.get(lastSent)

    // The link spoke recently enough on its own; a keep-alive would be noise.
    if (Duration.toMillis(interval) > now - sent) {
      return
    }

    yield* session.replies.request(KeepAliveMid.rev(1), {}).pipe(
      Effect.andThen(Ref.set(lastSent, now)),
      Effect.catchTags({
        RequestTimeout: () => Effect.fail(new ConnectionLost({ reason: "keep-alive timed out" })),
        CommandRejected: () => Effect.fail(new ConnectionLost({ reason: "keep-alive rejected" })),
        UnexpectedRevision: (error) => Effect.fail(new ConnectionLost({ reason: `keep-alive failed: ${error._tag}` })),
        PayloadDecodeError: (error) => Effect.fail(new ConnectionLost({ reason: `keep-alive failed: ${error._tag}` })),
        PayloadEncodeError: (error) => Effect.fail(new ConnectionLost({ reason: `keep-alive failed: ${error._tag}` }))
      })
    )
  }).pipe(Effect.forever)
