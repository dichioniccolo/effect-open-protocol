import { describe, expect, it } from "@effect/vitest"
import { Duration, Effect, Fiber, pipe, Ref, Schedule, Stream, SubscriptionRef } from "effect"
import { TestClock } from "effect/testing"
import { make as makeSimulator } from "../../simulator/ControllerSimulator.ts"
import { KeepAlive } from "../../src/protocol/Messages.ts"
import { DeviceId, type TighteningResult } from "../../src/protocol/TighteningResult.ts"
import { InMemoryNetwork, layer as layerInMemory } from "../../src/transport/InMemoryTransport.ts"
import { Endpoint } from "../../src/transport/Transport.ts"
import type { ConnectionState } from "../../src/connection/ConnectionState.ts"
import { make } from "../../src/connection/DeviceConnection.ts"

const deviceId = DeviceId.make("tool-1")
const endpoint = new Endpoint({ host: "simulator", port: 4545 })

const provided = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.scoped(effect).pipe(Effect.provide(layerInMemory), Effect.provide(InMemoryNetwork.layer))

const awaitState = (
  state: SubscriptionRef.SubscriptionRef<ConnectionState>,
  tag: ConnectionState["_tag"]
): Effect.Effect<ConnectionState> =>
  pipe(
    SubscriptionRef.changes(state),
    Stream.filter((current) => current._tag === tag),
    Stream.runHead,
    Effect.flatMap((head) => head._tag === "Some" ? Effect.succeed(head.value) : Effect.never)
  )

const resultSink = Effect.map(
  Ref.make<ReadonlyArray<TighteningResult>>([]),
  (received) => ({
    received,
    onResult: (result: TighteningResult) => Ref.update(received, (current) => [...current, result])
  })
)

describe("DeviceConnection", () => {
  it.effect("reaches Ready through the handshake", () =>
    provided(Effect.gen(function* () {
      yield* makeSimulator({ endpoint, controllerName: "Airbag1" })
      const connection = yield* make({ id: deviceId, endpoint })

      const ready = yield* awaitState(connection.state, "Ready")

      expect(ready).toMatchObject({ _tag: "Ready", controllerName: "Airbag1" })
    })))

  it.effect("subscribes when a result handler is configured", () =>
    provided(Effect.gen(function* () {
      const simulator = yield* makeSimulator({ endpoint })
      const sink = yield* resultSink
      const connection = yield* make({ id: deviceId, endpoint, onResult: sink.onResult })

      yield* awaitState(connection.state, "Ready")

      expect(yield* simulator.isSubscribed).toBe(true)
    })))

  it.effect("sends a keep-alive once the link goes idle", () =>
    provided(Effect.gen(function* () {
      const simulator = yield* makeSimulator({ endpoint })
      const connection = yield* make({ id: deviceId, endpoint, keepAliveInterval: Duration.seconds(10) })
      yield* awaitState(connection.state, "Ready")
      const before = yield* simulator.keepAlives

      yield* TestClock.adjust(Duration.seconds(11))
      yield* Effect.yieldNow

      expect(yield* simulator.keepAlives).toBeGreaterThan(before)
    })))

  it.effect("declares the session dead when keep-alives stop being answered", () =>
    provided(Effect.gen(function* () {
      yield* makeSimulator({ endpoint, silent: true })
      const connection = yield* make({
        id: deviceId,
        endpoint,
        keepAliveInterval: Duration.seconds(10),
        responseTimeout: Duration.seconds(5),
        reconnect: Schedule.spaced(Duration.seconds(1))
      })
      yield* awaitState(connection.state, "Ready")

      const waiting = yield* Effect.forkChild(awaitState(connection.state, "WaitingToReconnect"))
      yield* TestClock.adjust(Duration.seconds(20))

      expect(yield* Fiber.join(waiting)).toMatchObject({
        _tag: "WaitingToReconnect",
        reason: "keep-alive timed out"
      })
    })))

  it.effect("backs off after a rejected handshake", () =>
    provided(Effect.gen(function* () {
      yield* makeSimulator({ endpoint, rejectStartWith: 96 })
      const connection = yield* make({
        id: deviceId,
        endpoint,
        reconnect: Schedule.spaced(Duration.seconds(1))
      })

      const waiting = yield* awaitState(connection.state, "WaitingToReconnect")

      expect(waiting).toMatchObject({ _tag: "WaitingToReconnect", reason: "handshake rejected with code 96" })
    })))

  it.effect("keeps retrying until a controller appears", () =>
    provided(Effect.gen(function* () {
      const connection = yield* make({
        id: deviceId,
        endpoint,
        reconnect: Schedule.spaced(Duration.seconds(1))
      })
      yield* awaitState(connection.state, "WaitingToReconnect")

      yield* makeSimulator({ endpoint })
      const ready = yield* Effect.forkChild(awaitState(connection.state, "Ready"))
      yield* TestClock.adjust(Duration.seconds(5))

      expect(yield* Fiber.join(ready)).toMatchObject({ _tag: "Ready" })
    })))

  it.effect("fails a request made before the connection is ready", () =>
    provided(Effect.gen(function* () {
      const connection = yield* make({ id: deviceId, endpoint })

      const outcome = yield* Effect.result(connection.send(new KeepAlive()))

      expect(outcome._tag).toBe("Failure")
    })))

  it.effect("closes cleanly and reaches the terminal state", () =>
    provided(Effect.gen(function* () {
      yield* makeSimulator({ endpoint })
      const connection = yield* make({ id: deviceId, endpoint })
      yield* awaitState(connection.state, "Ready")

      yield* connection.close

      expect((yield* SubscriptionRef.get(connection.state))._tag).toBe("Closed")
      const afterClose = yield* Effect.result(connection.send(new KeepAlive()))
      expect(afterClose._tag).toBe("Failure")
    })))

  it.effect("closes while waiting to reconnect", () =>
    provided(Effect.gen(function* () {
      const connection = yield* make({
        id: deviceId,
        endpoint,
        reconnect: Schedule.spaced(Duration.seconds(1))
      })
      yield* awaitState(connection.state, "WaitingToReconnect")

      yield* connection.close

      expect((yield* SubscriptionRef.get(connection.state))._tag).toBe("Closed")
    })))
})
