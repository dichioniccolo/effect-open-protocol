import { describe, expect, it } from "@effect/vitest"
import { Duration, Effect, Fiber, pipe, Predicate, Ref, Result, Schedule, Stream, SubscriptionRef } from "effect"
import * as O from "effect/Option"
import { TestClock } from "effect/testing"
import { make as makeSimulator } from "../../simulator/ControllerSimulator.ts"
import { KeepAlive } from "../../src/protocol/Messages.ts"
import { DeviceId, type TighteningResult } from "../../src/protocol/TighteningResult.ts"
import { layerSimulated } from "../../simulator/SimulatorNetwork.ts"
import { Endpoint } from "../../src/transport/Transport.ts"
import { type ConnectionState, Ready, WaitingToReconnect } from "../../src/connection/ConnectionState.ts"
import { make as makeConnection } from "../../src/connection/DeviceConnection.ts"

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
        yield* makeSimulator({ endpoint, controllerName: "Airbag1" })
        const connection = yield* makeConnection({ id: deviceId, endpoint })

        const ready = yield* awaitState(connection.state, "Ready")

        expect(ready).toEqual(new Ready({ controllerName: "Airbag1" }))
      })
    )
  )

  it.effect("subscribes when a result handler is configured", () =>
    provided(
      Effect.gen(function* () {
        const simulator = yield* makeSimulator({ endpoint })
        const sink = yield* resultSink
        const connection = yield* makeConnection({ id: deviceId, endpoint, onResult: sink.onResult })

        yield* awaitState(connection.state, "Ready")

        expect(yield* simulator.isSubscribed).toBe(true)
      })
    )
  )

  it.effect("sends a keep-alive once the link goes idle", () =>
    provided(
      Effect.gen(function* () {
        const simulator = yield* makeSimulator({ endpoint })

        const connection = yield* makeConnection({
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
        yield* makeSimulator({ endpoint, silent: true })

        const connection = yield* makeConnection({
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
        yield* makeSimulator({ endpoint, rejectStartWith: 96 })

        const connection = yield* makeConnection({
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
        const connection = yield* makeConnection({
          id: deviceId,
          endpoint,
          reconnect: Schedule.spaced(Duration.seconds(1))
        })

        yield* awaitState(connection.state, "WaitingToReconnect")

        yield* makeSimulator({ endpoint })
        const ready = yield* Effect.forkChild(awaitState(connection.state, "Ready"))
        yield* TestClock.adjust(Duration.seconds(5))

        expect(yield* Fiber.join(ready)).toBeInstanceOf(Ready)
      })
    )
  )

  it.effect("fails a request made before the connection is ready", () =>
    provided(
      Effect.gen(function* () {
        const connection = yield* makeConnection({ id: deviceId, endpoint })

        const outcome = yield* Effect.result(connection.send(new KeepAlive()))

        expect(Result.isFailure(outcome)).toBe(true)
      })
    )
  )

  it.effect("closes cleanly and reaches the terminal state", () =>
    provided(
      Effect.gen(function* () {
        yield* makeSimulator({ endpoint })
        const connection = yield* makeConnection({ id: deviceId, endpoint })
        yield* awaitState(connection.state, "Ready")

        yield* connection.close

        expect(Predicate.isTagged(yield* SubscriptionRef.get(connection.state), "Closed")).toBe(true)
        const afterClose = yield* Effect.result(connection.send(new KeepAlive()))
        expect(Result.isFailure(afterClose)).toBe(true)
      })
    )
  )

  it.effect("closes while waiting to reconnect", () =>
    provided(
      Effect.gen(function* () {
        const connection = yield* makeConnection({
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
