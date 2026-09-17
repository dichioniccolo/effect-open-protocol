import { describe, expect, it } from "@effect/vitest"
import { Context, Effect, Layer, pipe, Ref, Scope, Stream, SubscriptionRef } from "effect"
import * as A from "effect/Array"
import { make as makeSimulator } from "../../simulator/ControllerSimulator.ts"
import type { ConnectionState } from "../../src/connection/ConnectionState.ts"
import { make as makeConnection } from "../../src/connection/DeviceConnection.ts"
import { DevicePool } from "../../src/pool/DevicePool.ts"
import { KeepAlive } from "../../src/protocol/Messages.ts"
import { DeviceId, type TighteningResult } from "../../src/protocol/TighteningResult.ts"
import { InMemoryNetwork, layer as layerInMemory } from "../../src/transport/InMemoryTransport.ts"
import { Endpoint } from "../../src/transport/Transport.ts"

const endpoint = new Endpoint({ host: "shutdown", port: 4545 })

const provided = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.provide(Effect.provide(Effect.scoped(effect), layerInMemory), InMemoryNetwork.layer)

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

const settle = <A>(
  effect: Effect.Effect<A>,
  predicate: (value: A) => boolean,
  attempts = 500
): Effect.Effect<A> =>
  Effect.flatMap(effect, (value) =>
    predicate(value) || attempts <= 0
      ? Effect.succeed(value)
      : Effect.andThen(Effect.yieldNow, settle(effect, predicate, attempts - 1)))

describe("shutdown", () => {
  it.effect("releases the session when the owning scope closes", () =>
    provided(Effect.gen(function* () {
      const simulator = yield* makeSimulator({ endpoint })
      const scope = yield* Scope.make()
      const connection = yield* Scope.provide(
        makeConnection({ id: DeviceId.make("tool-1"), endpoint, onResult: () => Effect.void }),
        scope
      )
      yield* awaitState(connection.state, "Ready")
      expect(yield* simulator.isSubscribed).toBe(true)

      yield* Scope.close(scope, Effect.void as never)

      yield* settle(simulator.isSubscribed, (subscribed) => !subscribed)
      expect(yield* simulator.isSubscribed).toBe(false)
      expect((yield* SubscriptionRef.get(connection.state))._tag).toBe("Closed")
    })))

  it.effect("stops delivering once the pool is closed", () =>
    provided(Effect.gen(function* () {
      const received = yield* Ref.make<ReadonlyArray<number>>([])
      const simulator = yield* makeSimulator({ endpoint })
      const scope = yield* Scope.make()
      const pool = yield* Scope.provide(
        Effect.map(Layer.build(DevicePool.layer), (context) => Context.get(context, DevicePool)),
        scope
      )
      const connection = yield* pool.add({
        id: DeviceId.make("tool-1"),
        endpoint,
        onResult: (result: TighteningResult) =>
          Ref.update(received, (current) => A.append(current, result.tighteningId as number))
      })
      yield* awaitState(connection.state, "Ready")
      yield* simulator.produce
      yield* settle(Ref.get(received), (current) => A.length(current) === 1)

      yield* Scope.close(scope, Effect.void as never)
      yield* settle(simulator.isSubscribed, (subscribed) => !subscribed)
      yield* simulator.produce
      yield* Effect.yieldNow
      yield* Effect.yieldNow

      expect(yield* Ref.get(received)).toEqual([1])
      expect((yield* SubscriptionRef.get(connection.state))._tag).toBe("Closed")
    })))

  it.effect("is safe to close twice and refuses later work", () =>
    provided(Effect.gen(function* () {
      const simulator = yield* makeSimulator({ endpoint })
      const connection = yield* makeConnection({ id: DeviceId.make("tool-1"), endpoint })
      yield* awaitState(connection.state, "Ready")

      yield* connection.close
      const again = yield* Effect.result(connection.close)
      const request = yield* Effect.result(connection.send(new KeepAlive()))

      expect(again._tag).toBe("Success")
      expect(request._tag).toBe("Failure")
      yield* settle(simulator.isSubscribed, (subscribed) => !subscribed)
      expect(yield* simulator.isSubscribed).toBe(false)
    })))
})
