/**
 * Writing frames the way a misbehaving controller would.
 *
 * Every byte a simulated controller sends goes through here, so the session
 * loop above says only *what* to send: delay, fragmentation, coalescing,
 * refusals and a dropped link are this module's business alone.
 *
 * @since 0.0.0
 */
import { Duration, Effect, Match, Ref } from "effect"
import * as A from "effect/Array"
import * as O from "effect/Option"
import { CommandError, encodeMessage, type Message } from "../src/protocol/Messages.ts"
import type { ServerSide } from "../src/transport/InMemoryTransport.ts"
import * as Faults from "./Faults.ts"
import { forget, type SessionState } from "./SessionState.ts"

/**
 * The encoder every simulated controller writes its frames with.
 *
 * @category constants
 * @since 0.0.0
 */
export const encoder = new TextEncoder()

/** How long a coalesced frame waits for a travelling companion. */
const coalesceFlushDelay = Duration.millis(50)

const concat = (chunks: ReadonlyArray<Uint8Array>): Uint8Array => {
  const total = A.reduce(chunks, 0, (sum, chunk) => sum + chunk.length)
  const joined = new Uint8Array(total)
  A.reduce(chunks, 0, (offset, chunk) => {
    joined.set(chunk, offset)

    return offset + chunk.length
  })

  return joined
}

/**
 * Turns a reply the controller was about to send into the refusal it would
 * send instead. A pushed result has no command to refuse, so it is left alone.
 */
const rejectionFor = (message: Message, code: number): O.Option<Message> =>
  Match.value(message).pipe(
    Match.tag("CommandAccepted", (accepted): O.Option<Message> =>
      O.some(new CommandError({ mid: accepted.mid, code }))
    ),
    Match.tag("CommunicationStartAccepted", (): O.Option<Message> => O.some(new CommandError({ mid: 1, code }))),
    Match.tag("OldResult", (): O.Option<Message> => O.some(new CommandError({ mid: 64, code }))),
    Match.tag("KeepAlive", (): O.Option<Message> => O.some(new CommandError({ mid: 9999, code }))),
    Match.orElse((): O.Option<Message> => O.none())
  )

/**
 * Sends a frame the way a misbehaving controller would: delayed, fragmented,
 * coalesced with the frame before it, refused, or not at all because the link
 * just died.
 *
 * @category sending
 * @since 0.0.0
 */
export const sendWithFaults = (
  connection: ServerSide,
  message: Message,
  faults: Faults.FaultConfig | undefined,
  state: Ref.Ref<SessionState>,
  refuseFor: (duration: Duration.Duration) => Effect.Effect<void>
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const bytes = encoder.encode(encodeMessage(message))
    const quiet = yield* Effect.map(Ref.get(state), (current) => current.quiet)

    const fault = yield* O.match(quiet ? O.none() : O.fromNullishOr(faults), {
      onNone: () => Effect.succeed(Faults.Fault.None()),
      onSome: (config) => Faults.next(config)
    })

    /** Empties what a coalesce fault held back, returning it. */
    const takePending = Ref.modify(state, (current) => [current.pending, { ...current, pending: [] }])

    /** Writes whatever a coalesce fault held back, in front of this frame. */
    const flush = Effect.fnUntraced(function* (frame: Uint8Array) {
      const pending = yield* takePending

      yield* Effect.ignore(connection.send(concat(A.append(pending, frame))))
    })

    return yield* Match.value(fault).pipe(
      Match.tag("None", () => flush(bytes)),
      Match.tag(
        "DropConnection",
        Effect.fnUntraced(function* () {
          yield* Ref.update(state, (current) => forget(current, connection))
          yield* connection.close("the controller dropped the connection")
        })
      ),
      Match.tag("GoSilent", (silent) => Effect.sleep(silent.duration)),
      Match.tag("DelayReply", (delayed) => Effect.andThen(Effect.sleep(delayed.duration), flush(bytes))),
      Match.tag(
        "SplitFrame",
        Effect.fnUntraced(function* (split) {
          const pending = yield* takePending

          yield* Effect.forEach(
            A.appendAll(pending, Faults.split(bytes, split.pieces)),
            (piece) => Effect.ignore(connection.send(piece)),
            { discard: true }
          )
        })
      ),
      // The frame is held back so it rides along with the next one and the
      // client sees two messages inside a single read. A short timer flushes it
      // anyway: coalescing delays frames, it does not eat them, and a quiet
      // link would otherwise hold a result until the session died.
      Match.tag(
        "CoalesceFrames",
        Effect.fnUntraced(function* () {
          yield* Ref.update(state, (current) => ({ ...current, pending: A.append(current.pending, bytes) }))

          const flushLater = Effect.gen(function* () {
            yield* Effect.sleep(coalesceFlushDelay)

            const held = yield* takePending

            if (A.length(held) > 0) {
              yield* Effect.ignore(connection.send(concat(held)))
            }
          })

          yield* Effect.forkChild(flushLater)
        })
      ),
      Match.tag("RejectCommand", (rejected) =>
        O.match(rejectionFor(message, rejected.code), {
          onNone: () => flush(bytes),
          onSome: (refusal) => flush(encoder.encode(encodeMessage(refusal)))
        })
      ),
      // The controller stops accepting new sessions for a while, the way one
      // does while it reboots. Established traffic is untouched, and the
      // window is owned by the simulator: a session that dies mid-outage must
      // not leave the endpoint refusing connections forever.
      Match.tag("RefuseConnections", (outage) => Effect.andThen(refuseFor(outage.duration), flush(bytes))),
      Match.exhaustive
    )
  })
