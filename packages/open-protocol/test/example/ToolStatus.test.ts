/**
 * The worked example of a user-defined MID: two revisions, a request whose
 * every revision declares its reply, a subscription to its pushes, and typed
 * exchanges over the in-memory transport.
 *
 * MIDs 9100 to 9104 and their layouts are illustrative, made up for this
 * example; they are not taken from the Open Protocol specification.
 */
import { describe, expect, expectTypeOf, it } from "@effect/vitest"
import { Duration, Effect, Exit, Fiber, Predicate, Queue, Ref, Schedule, Stream, SubscriptionRef } from "effect"
import * as A from "effect/Array"
import * as O from "effect/Option"
import * as R from "effect/Record"
import * as Str from "effect/String"
import { TestClock } from "effect/testing"
import { AlreadySubscribed, CommandRejected } from "../../src/connection/ConnectionError.ts"
import type { ConnectionState } from "../../src/connection/ConnectionState.ts"
import * as DeviceConnection from "../../src/connection/DeviceConnection.ts"
import type { Pushed } from "../../src/connection/Subscriptions.ts"
import * as Field from "../../src/protocol/Field.ts"
import { frames } from "../../src/protocol/Framer.ts"
import { decodeHeader, headerLength } from "../../src/protocol/Header.ts"
import {
  CommandAccepted,
  commandAccepted,
  CommandError,
  CommunicationStartAccepted,
  encodeMessage,
  KeepAlive,
  type Message
} from "../../src/protocol/Messages.ts"
import * as Mid from "../../src/protocol/Mid.ts"
import { DeviceId } from "../../src/protocol/TighteningResult.ts"
import { InMemoryNetwork, layerComplete, type ServerSide } from "../../src/transport/InMemoryTransport.ts"
import { Endpoint } from "../../src/transport/Transport.ts"

// --- The definitions a user writes -----------------------------------------

const status = [
  ["toolId", Field.digits({ id: "01", width: 3 })],
  ["temperature", Field.digits({ id: "02", width: 4 })]
] as const

/** MID 9101: a tool's status. Revision 2 appends the motor hours. */
const ToolStatus = Mid.define({
  tag: "ToolStatus",
  mid: 9101,
  revisions: {
    1: Field.layout(status),
    2: Field.layout([...status, ["motorHours", Field.digits({ id: "03", width: 6 })]])
  }
})

/** MID 9100: asks for a tool's status, answered at the same revision. */
const ToolStatusRequest = Mid.request(
  Mid.define({
    tag: "ToolStatusRequest",
    mid: 9100,
    revisions: {
      1: Field.layout([["toolId", Field.digits({ width: 3 })]]),
      2: Field.layout([["toolId", Field.digits({ width: 3 })]])
    }
  }),
  { 1: ToolStatus.rev(1), 2: ToolStatus.rev(2) }
)

// --- A controller that knows MID 9100 ---------------------------------------

const endpoint = new Endpoint({ host: "tool-controller", port: 4545 })

const deviceId = DeviceId.make("tool-1")

const encoder = new TextEncoder()

const statusOf = (toolId: number, revision: number) =>
  revision === 2
    ? Mid.encode(ToolStatus.rev(2), ToolStatus.rev(2).codec.make({ toolId, temperature: 412, motorHours: 1234 }))
    : Mid.encode(ToolStatus.rev(1), ToolStatus.rev(1).codec.make({ toolId, temperature: 412 }))

const answer = (frame: string) =>
  Effect.gen(function* () {
    const header = yield* Effect.fromResult(decodeHeader(frame))
    const data = Str.substring(headerLength, Str.length(frame))(frame)

    if (header.mid === 1) {
      return O.some(encodeMessage(new CommunicationStartAccepted({ cellId: 1, channelId: 1, controllerName: "Tools" })))
    }

    if (header.mid !== 9100) {
      return O.none()
    }

    const request = yield* O.match(ToolStatusRequest.lookup(header.revision), {
      onNone: () => Effect.die("unsupported revision"),
      onSome: (revision) => Mid.decode(revision, data)
    })

    return yield* Effect.map(
      Effect.fromResult(
        statusOf(Predicate.hasProperty(request, "toolId") ? Number(request.toolId) : 0, header.revision)
      ),
      O.some
    )
  })

const controller = Effect.gen(function* () {
  const network = yield* InMemoryNetwork
  const accepted = yield* network.bind(endpoint)

  yield* Effect.forkChild(
    Effect.gen(function* () {
      const server = yield* Queue.take(accepted)

      yield* Stream.runForEach(frames(server.incoming), (frame) =>
        Effect.gen(function* () {
          const reply = yield* Effect.orDie(answer(frame))

          if (O.isSome(reply)) {
            yield* server.send(encoder.encode(reply.value))
          }
        })
      )
    })
  )
})

const awaitReady = (state: SubscriptionRef.SubscriptionRef<ConnectionState>) =>
  Effect.gen(function* () {
    const ready = yield* Stream.runHead(
      Stream.filter(SubscriptionRef.changes(state), (current) => Predicate.isTagged(current, "Ready"))
    )

    return yield* O.match(ready, { onNone: () => Effect.never, onSome: Effect.succeed })
  })

const dataOf = (frame: string) => Str.substring(headerLength, Str.length(frame) - 1)(frame)

const provided = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.provide(Effect.scoped(effect), layerComplete)

describe("a user-defined MID", () => {
  it("has one exact type per revision, and so does its reply", () => {
    expectTypeOf<Mid.Type<ReturnType<typeof ToolStatus.rev<1>>>>().toEqualTypeOf<{
      readonly _tag: "ToolStatus"
      readonly revision: 1
      readonly toolId: number
      readonly temperature: number
    }>()
    expectTypeOf<Mid.Type<ReturnType<typeof ToolStatus.rev<2>>>>().toEqualTypeOf<{
      readonly _tag: "ToolStatus"
      readonly revision: 2
      readonly toolId: number
      readonly temperature: number
      readonly motorHours: number
    }>()
  })

  it.effect("round trips both revisions through frames", () =>
    Effect.gen(function* () {
      const values = [
        ToolStatus.rev(1).codec.make({ toolId: 7, temperature: 380 }),
        ToolStatus.rev(2).codec.make({ toolId: 7, temperature: 380, motorHours: 99 })
      ] as const

      const first = yield* Effect.fromResult(Mid.encode(ToolStatus.rev(1), values[0]))
      const second = yield* Effect.fromResult(Mid.encode(ToolStatus.rev(2), values[1]))

      expect(dataOf(first)).toBe("01007" + "020380")
      expect(dataOf(second)).toBe("01007" + "020380" + "03000099")
      expect(yield* Mid.decode(ToolStatus.rev(1), dataOf(first))).toEqual(values[0])
      expect(yield* Mid.decode(ToolStatus.rev(2), dataOf(second))).toEqual(values[1])
    })
  )

  it.effect("asks for each revision over the transport and gets exactly that revision back", () =>
    provided(
      Effect.gen(function* () {
        yield* controller
        const connection = yield* DeviceConnection.make({ id: deviceId, endpoint })
        yield* awaitReady(connection.state)

        const first = yield* connection.request(ToolStatusRequest.rev(1), { toolId: 7 })
        const second = yield* connection.request(ToolStatusRequest.rev(2), { toolId: 7 })

        expectTypeOf(first.revision).toEqualTypeOf<1>()
        expectTypeOf(second.motorHours).toEqualTypeOf<number>()
        expect(first).toEqual(ToolStatus.rev(1).codec.make({ toolId: 7, temperature: 412 }))
        expect(second).toEqual(ToolStatus.rev(2).codec.make({ toolId: 7, temperature: 412, motorHours: 1234 }))
      })
    )
  )
})

// --- Subscribing to its pushes ----------------------------------------------

const bare = (tag: string, mid: number) => Mid.define({ tag, mid, revisions: { 1: Field.layout([]) } })

/** MID 9102: subscribes to MID 9101 at the same revision, accepted with 0005. */
const SubscribeToolStatus = Mid.request(
  Mid.define({ tag: "SubscribeToolStatus", mid: 9102, revisions: { 1: Field.layout([]), 2: Field.layout([]) } }),
  { 1: commandAccepted, 2: commandAccepted }
)

/** MID 9103: acknowledges a pushed status; nothing answers it. */
const AcknowledgeToolStatus = bare("AcknowledgeToolStatus", 9103)

/** MID 9104: stops the pushes, accepted with 0005. */
const UnsubscribeToolStatus = Mid.request(bare("UnsubscribeToolStatus", 9104), { 1: commandAccepted })

const ToolStatusSubscription = Mid.subscription(ToolStatus, {
  1: {
    subscribe: SubscribeToolStatus.rev(1),
    ack: AcknowledgeToolStatus.rev(1),
    unsubscribe: UnsubscribeToolStatus.rev(1)
  },
  2: {
    subscribe: SubscribeToolStatus.rev(2),
    ack: AcknowledgeToolStatus.rev(1),
    unsubscribe: UnsubscribeToolStatus.rev(1)
  }
})

const ackTimeout = Duration.seconds(2)

/**
 * A controller that pushes MID 9101 once subscribed and resends it until
 * MID 9103 comes back. Every MID it receives is recorded, and every session is
 * handed to the test so it can push on it or drop it.
 */
const pushingController = (options: { readonly refuse: boolean }) =>
  Effect.gen(function* () {
    const network = yield* InMemoryNetwork
    const accepted = yield* network.bind(endpoint)
    const received = yield* Queue.unbounded<number>()
    const seen = yield* Ref.make<ReadonlyArray<number>>([])
    const sessions = yield* Queue.unbounded<ServerSide>()
    const acks = yield* Queue.unbounded<void>()

    // What it answers, by MID; MID 9103 and anything else get no answer.
    const replies: R.ReadonlyRecord<string, Message> = {
      1: new CommunicationStartAccepted({ cellId: 1, channelId: 1, controllerName: "Tools" }),
      3: new CommandAccepted({ mid: 3 }),
      9102: options.refuse ? new CommandError({ mid: 9102, code: 99 }) : new CommandAccepted({ mid: 9102 }),
      9104: new CommandAccepted({ mid: 9104 }),
      9999: new KeepAlive()
    }

    const serve = (server: ServerSide) =>
      Stream.runForEach(frames(server.incoming), (frame) =>
        Effect.gen(function* () {
          const header = yield* Effect.orDie(Effect.fromResult(decodeHeader(frame)))
          yield* Queue.offer(received, header.mid)
          yield* Ref.update(seen, A.append(header.mid))

          if (header.mid === 9103) {
            yield* Queue.offer(acks, undefined)
          }

          const reply = R.get(replies, `${header.mid}`)

          if (O.isSome(reply)) {
            yield* server.send(encoder.encode(encodeMessage(reply.value)))
          }
        })
      )

    yield* Effect.forkChild(
      Effect.forever(
        Effect.gen(function* () {
          const server = yield* Queue.take(accepted)
          yield* Queue.offer(sessions, server)
          yield* Effect.forkChild(Effect.ignore(serve(server)))
        })
      )
    )

    /** Waits until the controller has received MID `mid`. */
    const awaitMid = (mid: number): Effect.Effect<void> =>
      Effect.flatMap(Queue.take(received), (next) => (next === mid ? Effect.void : awaitMid(mid)))

    const push = (server: ServerSide, frame: string) => Effect.orDie(server.send(encoder.encode(frame)))

    /** Pushes `frame`, and pushes it again each time `ackTimeout` passes without MID 9103. */
    const pushUntilAcked = (server: ServerSide, frame: string): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* push(server, frame)
        const acked = yield* Effect.timeoutOption(Queue.take(acks), ackTimeout)

        if (O.isNone(acked)) {
          yield* pushUntilAcked(server, frame)
        }
      })

    return { sessions, awaitMid, push, pushUntilAcked, seen: Ref.get(seen) }
  })

const statusFrame = (toolId: number, temperature: number, motorHours: number) =>
  Effect.orDie(
    Effect.fromResult(Mid.encode(ToolStatus.rev(2), ToolStatus.rev(2).codec.make({ toolId, temperature, motorHours })))
  )

/** What the example subscribes to: MID 9101 revision 2, one value and its ack. */
type StatusPush = Pushed<Mid.Type<ReturnType<typeof ToolStatusSubscription.rev<2>>["data"]>>

const subscribed = (options: { readonly refuse: boolean }) =>
  Effect.gen(function* () {
    const pushing = yield* pushingController(options)

    const connection = yield* DeviceConnection.make({
      id: deviceId,
      endpoint,
      reconnect: Schedule.spaced(Duration.seconds(1))
    })

    yield* awaitReady(connection.state)
    const server = yield* Queue.take(pushing.sessions)

    return { controller: pushing, connection, server }
  })

describe("a subscription to a user-defined MID", () => {
  it("types each pushed value exactly, and refuses a control MID that needs a field", () => {
    expectTypeOf<StatusPush["value"]>().toEqualTypeOf<{
      readonly _tag: "ToolStatus"
      readonly revision: 2
      readonly toolId: number
      readonly temperature: number
      readonly motorHours: number
    }>()

    Mid.subscription(ToolStatus, {
      1: { subscribe: SubscribeToolStatus.rev(1) },
      // @ts-expect-error MID 9100 carries a tool id, so it cannot be sent bare as an ack
      2: { subscribe: SubscribeToolStatus.rev(2), ack: ToolStatusRequest.rev(2) }
    })
  })

  it.effect("subscribes, emits typed values, and acknowledges only when asked", () =>
    provided(
      Effect.gen(function* () {
        const setup = yield* subscribed({ refuse: false })
        const values = yield* Queue.unbounded<StatusPush>()

        yield* Effect.forkChild(
          Stream.runForEach(setup.connection.subscribe(ToolStatusSubscription.rev(2)), (pushed) =>
            Queue.offer(values, pushed)
          )
        )
        yield* setup.controller.awaitMid(9102)

        yield* setup.controller.push(setup.server, yield* statusFrame(7, 412, 1234))
        const first = yield* Queue.take(values)

        expectTypeOf(first.value.motorHours).toEqualTypeOf<number>()
        expect(first.value).toEqual(ToolStatus.rev(2).codec.make({ toolId: 7, temperature: 412, motorHours: 1234 }))
        expect(A.contains(yield* setup.controller.seen, 9103)).toBe(false)

        yield* first.ack
        yield* setup.controller.awaitMid(9103)
      })
    )
  )

  it.effect("gets a value it never acknowledged again", () =>
    provided(
      Effect.gen(function* () {
        const setup = yield* subscribed({ refuse: false })
        const values = yield* Queue.unbounded<StatusPush>()

        yield* Effect.forkChild(
          Stream.runForEach(setup.connection.subscribe(ToolStatusSubscription.rev(2)), (pushed) =>
            Queue.offer(values, pushed)
          )
        )
        yield* setup.controller.awaitMid(9102)

        const pushing = yield* Effect.forkChild(
          setup.controller.pushUntilAcked(setup.server, yield* statusFrame(7, 412, 1234))
        )

        const first = yield* Queue.take(values)

        // No ack: the controller gives up waiting and sends the same value again.
        yield* TestClock.adjust(ackTimeout)
        const resent = yield* Queue.take(values)

        expect(resent.value).toEqual(first.value)

        yield* resent.ack
        yield* Fiber.join(pushing)
      })
    )
  )

  it.effect("unsubscribes when the consumer stops, and frees the MID for the next one", () =>
    provided(
      Effect.gen(function* () {
        const setup = yield* subscribed({ refuse: false })
        const taken = yield* Effect.forkChild(Stream.runHead(setup.connection.subscribe(ToolStatusSubscription.rev(2))))
        yield* setup.controller.awaitMid(9102)

        yield* setup.controller.push(setup.server, yield* statusFrame(7, 412, 1234))
        const head = yield* Fiber.join(taken)

        expect(O.map(head, (pushed) => pushed.value.toolId)).toEqual(O.some(7))
        yield* setup.controller.awaitMid(9104)

        // The registry entry is gone: the MID can be subscribed again.
        const again = yield* Effect.forkChild(Stream.runHead(setup.connection.subscribe(ToolStatusSubscription.rev(2))))
        yield* setup.controller.awaitMid(9102)
        yield* setup.controller.push(setup.server, yield* statusFrame(8, 400, 1))

        expect(O.map(yield* Fiber.join(again), (pushed) => pushed.value.toolId)).toEqual(O.some(8))
      })
    )
  )

  it.effect("fails a second consumer of the same MID", () =>
    provided(
      Effect.gen(function* () {
        const setup = yield* subscribed({ refuse: false })
        yield* Effect.forkChild(Stream.runDrain(setup.connection.subscribe(ToolStatusSubscription.rev(2))))
        yield* setup.controller.awaitMid(9102)

        const second = yield* Effect.exit(Stream.runDrain(setup.connection.subscribe(ToolStatusSubscription.rev(1))))

        expect(second).toEqual(Exit.fail(new AlreadySubscribed({ mid: 9101 })))
      })
    )
  )

  it.effect("fails the stream when the controller refuses the subscription", () =>
    provided(
      Effect.gen(function* () {
        const setup = yield* subscribed({ refuse: true })

        const refused = yield* Effect.exit(Stream.runDrain(setup.connection.subscribe(ToolStatusSubscription.rev(2))))

        expect(refused).toEqual(Exit.fail(new CommandRejected({ mid: 9102, code: 99 })))
      })
    )
  )

  it.effect("keeps the same stream emitting across a reconnect, subscribing again", () =>
    provided(
      Effect.gen(function* () {
        const setup = yield* subscribed({ refuse: false })
        const values = yield* Queue.unbounded<StatusPush>()

        yield* Effect.forkChild(
          Stream.runForEach(setup.connection.subscribe(ToolStatusSubscription.rev(2)), (pushed) =>
            Effect.andThen(pushed.ack, Queue.offer(values, pushed))
          )
        )
        yield* setup.controller.awaitMid(9102)

        yield* setup.controller.push(setup.server, yield* statusFrame(1, 400, 10))
        expect((yield* Queue.take(values)).value.toolId).toBe(1)

        yield* setup.server.close("the controller dropped the session")
        yield* TestClock.adjust(Duration.seconds(1))
        const next = yield* Queue.take(setup.controller.sessions)
        yield* setup.controller.awaitMid(9102)
        yield* awaitReady(setup.connection.state)

        yield* setup.controller.push(next, yield* statusFrame(2, 401, 11))
        expect((yield* Queue.take(values)).value.toolId).toBe(2)
      })
    )
  )
})
