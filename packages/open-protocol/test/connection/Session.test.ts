import { describe, expect, it } from "@effect/vitest"
import { Duration, Effect, Ref, Stream } from "effect"
import * as A from "effect/Array"
import * as Str from "effect/String"
import * as RequestReply from "../../src/connection/RequestReply.ts"
import { readLoop } from "../../src/connection/Session.ts"
import { encodeMessage, KeepAlive, LastResult, type Message, UnknownMessage } from "../../src/protocol/Messages.ts"
import { ControllerTimestamp, TighteningId } from "../../src/protocol/TighteningResult.ts"
import { ConnectionLost } from "../../src/transport/Transport.ts"

const encoder = new TextEncoder()

const lastResult = encodeMessage(
  new LastResult({
    tighteningId: TighteningId.make(7),
    vin: "VIN7",
    parameterSetId: 1,
    status: "OK",
    torqueStatus: "OK",
    angleStatus: "OK",
    torque: 1.5,
    angle: 90,
    timestamp: ControllerTimestamp.make("2026-09-19:10:00:00"),
    parameterSetChangedAt: "2026-09-19:10:00:00"
  })
)

// The same frame with its status digit (parameter 09) turned into a letter:
// the header and length stay valid, only the data field is wrong.
const garbled =
  Str.substring(0, 20)(lastResult) + Str.replace("091", "09X")(Str.substring(20, Str.length(lastResult))(lastResult))

/** Runs the read loop over `frames` and returns what reached the caller and how the loop ended. */
const read = (frames: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const received = yield* Ref.make<ReadonlyArray<Message>>([])

    const replies = yield* RequestReply.make({
      send: () => Effect.void,
      responseTimeout: Duration.seconds(1)
    })

    const ended = yield* Effect.flip(
      readLoop(
        {
          duplex: {
            incoming: Stream.fromIterable(A.map(frames, (frame) => encoder.encode(frame))),
            send: () => Effect.void
          },
          replies
        },
        () => Effect.succeed(false),
        (message) => Ref.update(received, (current) => A.append(current, message))
      )
    )

    return { ended, received: yield* Ref.get(received) }
  })

describe("Session.readLoop", () => {
  it.effect("keeps reading after a data field that does not decode", () =>
    Effect.gen(function* () {
      const outcome = yield* read([garbled, encodeMessage(new KeepAlive())])

      expect(A.map(outcome.received, (message) => message._tag)).toEqual(["UnknownMessage", "KeepAlive"])
      expect(outcome.received[0]).toMatchObject(
        new UnknownMessage({ mid: 61, revision: 1, data: Str.substring(20, Str.length(garbled) - 1)(garbled) })
      )
      expect(outcome.ended).toEqual(new ConnectionLost({ reason: "the controller closed the connection" }))
    })
  )

  it.effect("still ends the session on a malformed header", () =>
    Effect.gen(function* () {
      const outcome = yield* read(["0020XXXX            \u0000", encodeMessage(new KeepAlive())])

      expect(outcome.received).toEqual([])
      expect(outcome.ended).toEqual(new ConnectionLost({ reason: "protocol error: MalformedHeader" }))
    })
  )
})
