import { describe, expect, it } from "@effect/vitest"
import { Duration, Effect, Fiber, Layer, pipe, Predicate, Ref, Result, Schedule, Stream, SubscriptionRef } from "effect"
import * as O from "effect/Option"
import { TestClock } from "effect/testing"
import * as ControllerSimulator from "../../simulator/ControllerSimulator.ts"
import { KeepAliveMid } from "../../src/protocol/Messages.ts"
import { DeviceId, type TighteningResult } from "../../src/protocol/TighteningResult.ts"
import { layerSimulated } from "../../simulator/SimulatorNetwork.ts"
import { Endpoint, Transport } from "../../src/transport/Transport.ts"
import { type ConnectionState, Ready, WaitingToReconnect } from "../../src/connection/ConnectionState.ts"
import * as DeviceConnection from "../../src/connection/DeviceConnection.ts"

const deviceId = DeviceId.make("tool-1")

const endpoint = new Endpoint({ host: "simulator", port: 4545 })

const provided = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.scoped(effect).pipe(Effect.provide(layerSimulated))

const awaitState = (
  state: SubscriptionRef.SubscriptionRef<ConnectionState>,
  tag: ConnectionState["_tag"]
): Effect.Effect<ConnectionState> =>
  pipe(
    SubscriptionRef.changes(state),
    Stream.filter((current) => Predicate.isTagged(current, tag)),
    Stream.runHead,
    Effect.flatMap(O.match({ onNone: () => Effect.never, onSome: Effect.succeed }))
  )

const resultSink = Effect.map(Ref.make<ReadonlyArray<TighteningResult>>([]), (received) => ({
  received,
  onResult: (result: TighteningResult) => Ref.update(received, (current) => [...current, result])
}))

describe("DeviceConnection", () => {
  it.effect("reaches Ready through the handshake", () =>
    provided(
      Effect.gen(function* () {
        yield* ControllerSimulator.make({ endpoint, controllerName: "Airbag1" })
        const connection = yield* DeviceConnection.make({ id: deviceId, endpoint })

        const ready = yield* awaitState(connection.state, "Ready")

        expect(ready).toEqual(new Ready({ controllerName: "Airbag1" }))
      })
    )
  )

  it.effect("subscribes when a result handler is configured", () =>
    provided(
      Effect.gen(function* () {
        const simulator = yield* ControllerSimulator.make({ endpoint })
        const sink = yield* resultSink
        const connection = yield* DeviceConnection.make({ id: deviceId, endpoint, onResult: sink.onResult })

        yield* awaitState(connection.state, "Ready")

        expect(yield* simulator.isSubscribed).toBe(true)
      })
    )
  )

  it.effect("sends a keep-alive once the link goes idle", () =>
    provided(
      Effect.gen(function* () {
        const simulator = yield* ControllerSimulator.make({ endpoint })

        const connection = yield* DeviceConnection.make({
          id: deviceId,
          endpoint,
          keepAliveInterval: Duration.seconds(10)
        })

        yield* awaitState(connection.state, "Ready")
        const before = yield* simulator.keepAlives

        yield* TestClock.adjust(Duration.seconds(11))
        yield* Effect.yieldNow

        expect(yield* simulator.keepAlives).toBeGreaterThan(before)
      })
    )
  )

  it.effect("declares the session dead when keep-alives stop being answered", () =>
    provided(
      Effect.gen(function* () {
        yield* ControllerSimulator.make({ endpoint, silent: true })

        const connection = yield* DeviceConnection.make({
          id: deviceId,
          endpoint,
          keepAliveInterval: Duration.seconds(10),
          responseTimeout: Duration.seconds(5),
          reconnect: Schedule.spaced(Duration.seconds(1))
        })

        yield* awaitState(connection.state, "Ready")

        const waiting = yield* Effect.forkChild(awaitState(connection.state, "WaitingToReconnect"))
        yield* TestClock.adjust(Duration.seconds(20))

        const waited = yield* Fiber.join(waiting)

        expect(waited).toBeInstanceOf(WaitingToReconnect)
        expect(waited).toMatchObject({ reason: "keep-alive timed out" })
      })
    )
  )

  it.effect("backs off after a rejected handshake", () =>
    provided(
      Effect.gen(function* () {
        yield* ControllerSimulator.make({ endpoint, rejectStartWith: 96 })

        const connection = yield* DeviceConnection.make({
          id: deviceId,
          endpoint,
          reconnect: Schedule.spaced(Duration.seconds(1))
        })

        const waiting = yield* awaitState(connection.state, "WaitingToReconnect")

        expect(waiting).toBeInstanceOf(WaitingToReconnect)
        expect(waiting).toMatchObject({ reason: "handshake rejected with code 96" })
      })
    )
  )

  it.effect("keeps retrying until a controller appears", () =>
    provided(
      Effect.gen(function* () {
        const connection = yield* DeviceConnection.make({
          id: deviceId,
          endpoint,
          reconnect: Schedule.spaced(Duration.seconds(1))
        })

        yield* awaitState(connection.state, "WaitingToReconnect")

        yield* ControllerSimulator.make({ endpoint })
        const ready = yield* Effect.forkChild(awaitState(connection.state, "Ready"))
        yield* TestClock.adjust(Duration.seconds(5))

        expect(yield* Fiber.join(ready)).toBeInstanceOf(Ready)
      })
    )
  )

  it.effect("gives up on a connection that does not open and backs off", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const connection = yield* DeviceConnection.make({
          id: deviceId,
          endpoint,
          connectTimeout: Duration.seconds(3),
          reconnect: Schedule.spaced(Duration.seconds(1))
        })

        const waiting = yield* Effect.forkChild(awaitState(connection.state, "WaitingToReconnect"))
        yield* TestClock.adjust(Duration.seconds(3))

        expect(yield* Fiber.join(waiting)).toMatchObject({ reason: "no connection within 3s" })
      })
    ).pipe(
      // A host that is down never answers the connection request.
      Effect.provide(Layer.succeed(Transport)({ connect: () => Effect.never }))
    )
  )

  it.effect("starts the backoff over after a healthy session", () =>
    provided(
      Effect.gen(function* () {
        const simulator = yield* ControllerSimulator.make({ endpoint })
        yield* simulator.refuse(true)

        const connection = yield* DeviceConnection.make({
          id: deviceId,
          endpoint,
          reconnect: Schedule.exponential(Duration.seconds(1))
        })

        // Four refused attempts, 1 + 2 + 4 seconds apart. The next wait is 8.
        yield* awaitState(connection.state, "WaitingToReconnect")
        yield* TestClock.adjust(Duration.seconds(7))
        yield* simulator.refuse(false)

        const ready = yield* Effect.forkChild(awaitState(connection.state, "Ready"))
        yield* TestClock.adjust(Duration.seconds(8))
        yield* Fiber.join(ready)

        yield* simulator.drop
        yield* awaitState(connection.state, "WaitingToReconnect")

        const again = yield* Effect.forkChild(awaitState(connection.state, "Ready"))
        yield* TestClock.adjust(Duration.seconds(1))

        expect(yield* Fiber.join(again)).toBeInstanceOf(Ready)
      })
    )
  )

  it.effect("fails a request made before the connection is ready", () =>
    provided(
      Effect.gen(function* () {
        const connection = yield* DeviceConnection.make({ id: deviceId, endpoint })

        const outcome = yield* Effect.result(connection.send(KeepAliveMid.rev(1), {}))

        expect(Result.isFailure(outcome)).toBe(true)
      })
    )
  )

  it.effect("closes cleanly and reaches the terminal state", () =>
    provided(
      Effect.gen(function* () {
        yield* ControllerSimulator.make({ endpoint })
        const connection = yield* DeviceConnection.make({ id: deviceId, endpoint })
        yield* awaitState(connection.state, "Ready")

        yield* connection.close

        expect(Predicate.isTagged(yield* SubscriptionRef.get(connection.state), "Closed")).toBe(true)
        const afterClose = yield* Effect.result(connection.send(KeepAliveMid.rev(1), {}))
        expect(Result.isFailure(afterClose)).toBe(true)
      })
    )
  )

  it.effect("closes while waiting to reconnect", () =>
    provided(
      Effect.gen(function* () {
        const connection = yield* DeviceConnection.make({
          id: deviceId,
          endpoint,
          reconnect: Schedule.spaced(Duration.seconds(1))
        })

        yield* awaitState(connection.state, "WaitingToReconnect")

        yield* connection.close

        expect(Predicate.isTagged(yield* SubscriptionRef.get(connection.state), "Closed")).toBe(true)
      })
    )
  )
})
