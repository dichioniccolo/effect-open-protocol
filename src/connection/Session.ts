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
import { Duration, Effect, pipe, Ref, Stream } from "effect"
import { frames } from "../protocol/Framer.ts"
import { decodeMessage, encodeMessage, KeepAlive, type Message } from "../protocol/Messages.ts"
import type { DeviceId } from "../protocol/TighteningResult.ts"
import { ConnectionLost, type Duplex } from "../transport/Transport.ts"
import { expectReply } from "./RequestReply.ts"
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
 * Writes a message straight to the socket, without expecting a reply.
 *
 * @category sending
 * @since 0.0.0
 */
export const sendRaw = (duplex: Duplex, message: Message): Effect.Effect<void, ConnectionLost> =>
  duplex.send(encoder.encode(encodeMessage(message)))

/**
 * A framing or decoding error leaves the byte stream unsynchronised, and TCP
 * offers no boundary to resynchronise on, so the session is declared lost.
 */
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
  pipe(
    frames(session.duplex.incoming),
    Stream.runForEach((frame) =>
      pipe(
        Effect.fromResult(decodeMessage(frame, deviceId)),
        Effect.flatMap((message) =>
          pipe(
            session.replies.offer(message),
            Effect.flatMap((consumed) => consumed ? Effect.void : onUnsolicited(message))
          )
        )
      )
    ),
    Effect.catchTags({
      MalformedHeader: (error) => protocolLost(error._tag),
      InvalidLength: (error) => protocolLost(error._tag),
      MissingTerminator: (error) => protocolLost(error._tag),
      UnsupportedFeature: (error) => protocolLost(error._tag),
      PayloadDecodeError: (error) => protocolLost(error._tag)
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
  pipe(
    Effect.sleep(interval),
    Effect.andThen(Effect.clockWith((clock) => clock.currentTimeMillis)),
    Effect.flatMap((now) =>
      pipe(
        Ref.get(lastSent),
        Effect.flatMap((sent) =>
          Duration.toMillis(interval) > now - sent
            ? Effect.void
            : pipe(
              session.replies.request(new KeepAlive(), 9999, expectReply(9999, "KeepAlive")),
              Effect.andThen(Ref.set(lastSent, now)),
              Effect.catchTag("RequestTimeout", () => Effect.fail(new ConnectionLost({ reason: "keep-alive timed out" }))),
              Effect.catchTag("CommandRejected", () => Effect.fail(new ConnectionLost({ reason: "keep-alive rejected" })))
            )
        )
      )
    ),
    Effect.forever
  )
