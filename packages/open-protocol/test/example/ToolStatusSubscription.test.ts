/**
 * The worked example's pushes: subscribing to MID 9101 over the in-memory
 * transport, acknowledging on demand, and keeping the stream across a
 * reconnect. The definitions are in `ToolStatus.ts`.
 */
import { describe, expect, expectTypeOf, it } from "@effect/vitest"
import { Duration, Effect, Exit, Fiber, Queue, Ref, Schedule, Stream } from "effect"
import * as A from "effect/Array"
import * as O from "effect/Option"
import * as R from "effect/Record"
import { TestClock } from "effect/testing"
import { AlreadySubscribed, CommandRejected } from "../../src/connection/ConnectionError.ts"
import * as DeviceConnection from "../../src/connection/DeviceConnection.ts"
import { CommandAccepted, CommandError, encodeMessage, KeepAlive, type Message } from "../../src/protocol/Messages.ts"
import * as Mid from "../../src/protocol/Mid.ts"
import type { ServerSide } from "../../src/transport/InMemoryTransport.ts"
import { awaitReady, deviceId, endpoint, provided, scriptedController } from "./ScriptedController.ts"
import { SubscribeToolStatus, ToolStatus, ToolStatusRequest, ToolStatusSubscription } from "./ToolStatus.ts"

/** What the example subscribes to: MID 9101 revision 2, one value and its ack. */
type StatusPush = DeviceConnection.Pushed<Mid.Type<ReturnType<typeof ToolStatusSubscription.rev<2>>["data"]>>

const ackTimeout = Duration.seconds(2)

/**
 * A controller that accepts MID 9104 and MID 9102, refusing the latter with
 * code 99 from its `refuseFrom`-th time on; MID 9103 gets no answer.
 */
const pushingController = (options: { readonly refuseFrom: number }) =>
  Effect.gen(function* () {
    const subscribes = yield* Ref.make(0)

    const replies: R.ReadonlyRecord<string, Message> = {
      3: new CommandAccepted({ mid: 3 }),
      9104: new CommandAccepted({ mid: 9104 }),
      9999: new KeepAlive()
    }

    const scripted = yield* scriptedController((header) =>
      header.mid === 9102
        ? Effect.map(
            Ref.updateAndGet(subscribes, (count) => count + 1),
            (count) =>
              O.some(
                encodeMessage(
                  count >= options.refuseFrom
                    ? new CommandError({ mid: 9102, code: 99 })
                    : new CommandAccepted({ mid: 9102 })
                )
              )
          )
        : Effect.succeed(O.map(R.get(replies, `${header.mid}`), encodeMessage))
    )

    /** Pushes `frame`, and pushes it again each time `ackTimeout` passes without MID 9103. */
    const pushUntilAcked = (server: ServerSide, frame: string): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* scripted.push(server, frame)
        const acked = yield* Effect.timeoutOption(scripted.awaitMid(9103), ackTimeout)

        if (O.isNone(acked)) {
          yield* pushUntilAcked(server, frame)
        }
      })

    return { ...scripted, pushUntilAcked }
  })

const statusFrame = (toolId: number, temperature: number, motorHours: number) =>
  Effect.orDie(
    Effect.fromResult(Mid.encode(ToolStatus.rev(2), ToolStatus.rev(2).codec.make({ toolId, temperature, motorHours })))
  )

const subscribed = (options: { readonly refuseFrom: number }) =>
  Effect.gen(function* () {
    const controller = yield* pushingController(options)

    const connection = yield* DeviceConnection.make({
      id: deviceId,
      endpoint,
      reconnect: Schedule.spaced(Duration.seconds(1))
    })

    yield* awaitReady(connection.state)
    const server = yield* Queue.take(controller.sessions)

    return { controller, connection, server }
  })

/** Collects every element of the example subscription, running `onPushed` on each first. */
const collected = (
  connection: DeviceConnection.DeviceConnectionService,
  onPushed: (pushed: StatusPush) => Effect.Effect<void, unknown> = () => Effect.void
) =>
  Effect.gen(function* () {
    const values = yield* Queue.unbounded<StatusPush>()

    yield* Effect.forkChild(
      Stream.runForEach(connection.subscribe(ToolStatusSubscription.rev(2)), (pushed) =>
        Effect.andThen(onPushed(pushed), Queue.offer(values, pushed))
      )
    )

    return values
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
        const setup = yield* subscribed({ refuseFrom: Infinity })
        const values = yield* collected(setup.connection)

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
        const setup = yield* subscribed({ refuseFrom: Infinity })
        const values = yield* collected(setup.connection)

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
        const setup = yield* subscribed({ refuseFrom: Infinity })
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
        const setup = yield* subscribed({ refuseFrom: Infinity })
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
        const setup = yield* subscribed({ refuseFrom: 1 })

        const refused = yield* Effect.exit(Stream.runDrain(setup.connection.subscribe(ToolStatusSubscription.rev(2))))

        expect(refused).toEqual(Exit.fail(new CommandRejected({ mid: 9102, code: 99 })))
      })
    )
  )

  it.effect("keeps the same stream emitting across a reconnect, subscribing again", () =>
    provided(
      Effect.gen(function* () {
        const setup = yield* subscribed({ refuseFrom: Infinity })
        const values = yield* collected(setup.connection, (pushed) => pushed.ack)

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

  it.effect("fails only its own stream when the controller refuses it after a reconnect", () =>
    provided(
      Effect.gen(function* () {
        const setup = yield* subscribed({ refuseFrom: 2 })

        const refused = yield* Effect.forkChild(
          Effect.exit(Stream.runDrain(setup.connection.subscribe(ToolStatusSubscription.rev(2))))
        )

        yield* setup.controller.awaitMid(9102)
        yield* setup.server.close("the controller dropped the session")
        yield* TestClock.adjust(Duration.seconds(1))

        expect(yield* Fiber.join(refused)).toEqual(Exit.fail(new CommandRejected({ mid: 9102, code: 99 })))

        // The session survives the refusal, and the MID is free again.
        yield* awaitReady(setup.connection.state)
        const again = yield* Effect.exit(Stream.runDrain(setup.connection.subscribe(ToolStatusSubscription.rev(2))))

        expect(again).toEqual(Exit.fail(new CommandRejected({ mid: 9102, code: 99 })))
      })
    )
  )
})
