import { describe, expect, it } from "@effect/vitest"
import { Duration, Effect, pipe, Ref, Schedule, Stream, SubscriptionRef } from "effect"
import * as A from "effect/Array"
import { TestClock } from "effect/testing"
import { make as makeSimulator } from "../../simulator/ControllerSimulator.ts"
import type { ConnectionState } from "../../src/connection/ConnectionState.ts"
import { make as makeConnection } from "../../src/connection/DeviceConnection.ts"
import { DeviceId, type TighteningResult } from "../../src/protocol/TighteningResult.ts"
import { InMemoryNetwork, layer as layerInMemory } from "../../src/transport/InMemoryTransport.ts"
import { Endpoint } from "../../src/transport/Transport.ts"

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

/** Lets fibers run until a condition holds, without waiting on wall-clock time. */
const settle = <A>(
  effect: Effect.Effect<A>,
  predicate: (value: A) => boolean,
  attempts = 500
): Effect.Effect<A> =>
  Effect.flatMap(effect, (value) =>
    predicate(value) || attempts <= 0
      ? Effect.succeed(value)
      : Effect.andThen(Effect.yieldNow, settle(effect, predicate, attempts - 1)))

const sink = Effect.map(
  Ref.make<ReadonlyArray<number>>([]),
  (received) => ({
    received,
    onResult: (result: TighteningResult) =>
      Ref.update(received, (current) => A.append(current, result.tighteningId as number))
  })
)

describe("result delivery over a connection", () => {
  it.effect("delivers pushed results and acknowledges them", () =>
    provided(Effect.gen(function* () {
      const simulator = yield* makeSimulator({ endpoint })
      const handler = yield* sink
      const connection = yield* makeConnection({ id: deviceId, endpoint, onResult: handler.onResult })
      yield* awaitState(connection.state, "Ready")

      yield* simulator.produce
      yield* simulator.produce
      const received = yield* settle(Ref.get(handler.received), (current) => A.length(current) === 2)

      expect(received).toEqual([1, 2])
      expect(yield* simulator.abandoned).toEqual([])
      expect(yield* connection.delivered).toBe(2)
    })))

  it.effect("delivers a result once even when the controller resends it", () =>
    provided(Effect.gen(function* () {
      const simulator = yield* makeSimulator({ endpoint, ackTimeout: Duration.seconds(2) })
      const handler = yield* sink
      const connection = yield* makeConnection({
        id: deviceId,
        endpoint,
        onResult: (result) => Effect.andThen(Effect.sleep(Duration.seconds(5)), handler.onResult(result))
      })
      yield* awaitState(connection.state, "Ready")

      yield* simulator.produce
      // The controller gives up waiting and resends while the handler is busy.
      yield* TestClock.adjust(Duration.seconds(3))
      yield* TestClock.adjust(Duration.seconds(10))
      const received = yield* settle(Ref.get(handler.received), (current) => A.length(current) >= 1)

      expect(received).toEqual([1])
      expect(yield* connection.delivered).toBe(1)
      expect(yield* connection.duplicates).toBeGreaterThanOrEqual(1)
    })))

  it.effect("recovers the results produced while the link was down", () =>
    provided(Effect.gen(function* () {
      const simulator = yield* makeSimulator({ endpoint })
      const handler = yield* sink
      const connection = yield* makeConnection({
        id: deviceId,
        endpoint,
        reconnect: Schedule.spaced(Duration.millis(100)),
        onResult: handler.onResult
      })
      yield* awaitState(connection.state, "Ready")

      yield* simulator.produce
      yield* settle(Ref.get(handler.received), (current) => A.length(current) === 1)

      // The controller drops the link, then keeps working: results 2 and 3 are
      // produced with nobody listening, so only MID 0064 can get them back.
      yield* simulator.drop
      yield* simulator.produce
      yield* simulator.produce
      yield* awaitState(connection.state, "WaitingToReconnect")
      yield* TestClock.adjust(Duration.seconds(1))
      yield* awaitState(connection.state, "Ready")

      const received = yield* settle(Ref.get(handler.received), (current) => A.length(current) === 3)

      expect(received).toEqual([1, 2, 3])
      expect(A.dedupe(received)).toEqual(received)
    })))
})
