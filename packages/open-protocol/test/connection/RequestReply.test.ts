import { describe, expect, it } from "@effect/vitest"
import { Duration, Effect, Ref } from "effect"
import * as A from "effect/Array"
import * as O from "effect/Option"
import { CommandRejected } from "../../src/connection/ConnectionError.ts"
import * as RequestReply from "../../src/connection/RequestReply.ts"
import * as Field from "../../src/protocol/Field.ts"
import {
  CommandAccepted,
  CommandError,
  decodeFrame,
  encodeMessage,
  type Message,
  UnknownMessage
} from "../../src/protocol/Messages.ts"
import * as Mid from "../../src/protocol/Mid.ts"
import { UnexpectedRevision } from "../../src/protocol/ProtocolError.ts"
import { DeviceId } from "../../src/protocol/TighteningResult.ts"

const deviceId = DeviceId.make("tool-1")

// Illustrative definitions in an unused MID range; not taken from the Open
// Protocol specification.
const Status = Mid.define({
  tag: "Status",
  mid: 7001,
  revisions: {
    1: Field.layout([["level", Field.digits({ width: 4 })]]),
    2: Field.layout([
      ["level", Field.digits({ width: 4 })],
      ["label", Field.text({ width: 6 })]
    ])
  }
})

const AskStatus = Mid.request(Mid.define({ tag: "AskStatus", mid: 7000, revisions: { 1: Field.layout([]) } }), {
  1: Status.rev(1)
})

const Reset = Mid.request(
  Mid.define({ tag: "Reset", mid: 7002, revisions: { 1: Field.layout([["level", Field.digits({ width: 4 })]]) } }),
  { 1: Mid.accepted }
)

const Notify = Mid.request(Mid.define({ tag: "Notify", mid: 7003, revisions: { 1: Field.layout([]) } }), {
  1: Mid.noReply
})

const incomingOf = (message: Message) => Effect.orDie(decodeFrame(encodeMessage(message), deviceId))

/**
 * A slot whose peer answers every frame with `answer`, and remembers what was
 * sent. The answer is offered from inside `send`, the way a fast controller's
 * reply can land before the request starts waiting.
 */
const peer = (answer: O.Option<Message>) =>
  Effect.gen(function* () {
    const sent = yield* Ref.make<ReadonlyArray<string>>([])
    const slot = yield* Ref.make(O.none<RequestReply.RequestReply>())

    const replies = yield* RequestReply.make({
      deviceId,
      responseTimeout: Duration.minutes(5),
      send: (frame) =>
        Effect.gen(function* () {
          yield* Ref.update(sent, (current) => A.append(current, frame))

          const current = yield* Ref.get(slot)

          yield* O.match(O.all([current, answer]), {
            onNone: () => Effect.void,
            onSome: ([slotted, message]) => Effect.asVoid(Effect.flatMap(incomingOf(message), slotted.offer))
          })
        })
    })

    yield* Ref.set(slot, O.some(replies))

    return { replies, sent }
  })

describe("RequestReply", () => {
  it.effect("decodes a dedicated reply that arrives as an unknown frame", () =>
    Effect.gen(function* () {
      const setup = yield* peer(O.some(new UnknownMessage({ mid: 7001, revision: 1, data: "0042" })))

      const status = yield* setup.replies.request(AskStatus.rev(1), {})

      expect(status).toEqual(Status.rev(1).codec.make({ level: 42 }))
    })
  )

  it.effect("fails at once when the reply comes at another revision", () =>
    Effect.gen(function* () {
      const setup = yield* peer(O.some(new UnknownMessage({ mid: 7001, revision: 2, data: "0042ready " })))

      const error = yield* Effect.flip(setup.replies.request(AskStatus.rev(1), {}))

      expect(error).toEqual(new UnexpectedRevision({ mid: 7001, expected: 1, received: 2 }))
    })
  )

  it.effect("fails with a decode error when the reply's data field is wrong", () =>
    Effect.gen(function* () {
      const setup = yield* peer(O.some(new UnknownMessage({ mid: 7001, revision: 1, data: "4x" })))

      const error = yield* Effect.flip(setup.replies.request(AskStatus.rev(1), {}))

      expect(error._tag).toBe("PayloadDecodeError")
    })
  )

  it.effect("turns a 0004 for the request into CommandRejected", () =>
    Effect.gen(function* () {
      const setup = yield* peer(O.some(new CommandError({ mid: 7000, code: 99 })))

      const error = yield* Effect.flip(setup.replies.request(AskStatus.rev(1), {}))

      expect(error).toEqual(new CommandRejected({ mid: 7000, code: 99 }))
    })
  )

  it.effect("resolves an accepted request with its 0005 and sends the payload", () =>
    Effect.gen(function* () {
      const setup = yield* peer(O.some(new CommandAccepted({ mid: 7002 })))

      const accepted = yield* setup.replies.request(Reset.rev(1), { level: 3 })

      expect(accepted).toEqual(new CommandAccepted({ mid: 7002 }))
      expect(yield* Ref.get(setup.sent)).toEqual([
        "0024" + "7002" + "001" + "0" + "01" + "01" + "00" + "0" + "0" + "0003" + "\u0000"
      ])
    })
  )

  it.effect("returns once a request that expects nothing is sent", () =>
    Effect.gen(function* () {
      const setup = yield* peer(O.none())

      yield* setup.replies.request(Notify.rev(1), {})

      expect(A.length(yield* Ref.get(setup.sent))).toBe(1)
    })
  )

  it.effect("refuses a payload that does not fit before sending anything", () =>
    Effect.gen(function* () {
      const setup = yield* peer(O.none())

      const error = yield* Effect.flip(setup.replies.request(Reset.rev(1), { level: 12345 }))

      expect(error._tag).toBe("PayloadEncodeError")
      expect(yield* Ref.get(setup.sent)).toEqual([])
    })
  )

  it.effect("leaves messages that answer nothing to the caller", () =>
    Effect.gen(function* () {
      const setup = yield* peer(O.none())

      expect(yield* setup.replies.offer(yield* incomingOf(new CommandAccepted({ mid: 60 })))).toBe(false)
    })
  )
})
