import { describe, expect, it } from "@effect/vitest"
import { Context, Duration, Effect, Fiber, Layer, pipe, Ref, Scope, Stream, SubscriptionRef } from "effect"
import * as A from "effect/Array"
import { make as makeSimulator } from "../../simulator/ControllerSimulator.ts"
import type { ConnectionState } from "../../src/connection/ConnectionState.ts"
import { makeDeviceConnection } from "../../src/connection/DeviceConnection.ts"
import { DevicePool } from "../../src/pool/DevicePool.ts"
import { KeepAlive } from "../../src/protocol/Messages.ts"
import { DeviceId, type TighteningResult } from "../../src/protocol/TighteningResult.ts"
import { layerComplete } from "../../src/transport/InMemoryTransport.ts"
import { Endpoint } from "../../src/transport/Transport.ts"

const endpoint = new Endpoint({ host: "shutdown", port: 4545 })

const provided = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.provide(Effect.scoped(effect), layerComplete)

const awaitState = (
  state: SubscriptionRef.SubscriptionRef<ConnectionState>,
  tag: ConnectionState["_tag"]
): Effect.Effect<ConnectionState> =>
  pipe(
    SubscriptionRef.changes(state),
    Stream.filter((current) => current._tag === tag),
    Stream.runHead,
    Effect.flatMap((head) => (head._tag === "Some" ? Effect.succeed(head.value) : Effect.never))
  )

const settle = <A>(effect: Effect.Effect<A>, predicate: (value: A) => boolean, attempts = 500): Effect.Effect<A> =>
  Effect.flatMap(effect, (value) =>
    predicate(value) || attempts <= 0
      ? Effect.succeed(value)
      : Effect.andThen(Effect.yieldNow, settle(effect, predicate, attempts - 1))
  )

describe("shutdown", () => {
  it.effect("releases the session when the owning scope closes", () =>
    provided(
      Effect.gen(function* () {
        const simulator = yield* makeSimulator({ endpoint })
        const scope = yield* Scope.make()
        const connection = yield* Scope.provide(
          makeDeviceConnection({ id: DeviceId.make("tool-1"), endpoint, onResult: () => Effect.void }),
          scope
        )
        yield* awaitState(connection.state, "Ready")
        expect(yield* simulator.isSubscribed).toBe(true)

        yield* Scope.close(scope, Effect.void as never)

        yield* settle(simulator.isSubscribed, (subscribed) => !subscribed)
        expect(yield* simulator.isSubscribed).toBe(false)
        expect((yield* SubscriptionRef.get(connection.state))._tag).toBe("Closed")
      })
    )
  )

  it.effect("stops delivering once the pool is closed", () =>
    provided(
      Effect.gen(function* () {
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
      })
    )
  )

  it.effect("says goodbye with a communication stop before closing", () =>
    provided(
      Effect.gen(function* () {
        const simulator = yield* makeSimulator({ endpoint })
        const connection = yield* makeDeviceConnection({ id: DeviceId.make("tool-1"), endpoint })
        yield* awaitState(connection.state, "Ready")
        expect(yield* simulator.stops).toBe(0)

        yield* connection.close

        yield* settle(simulator.stops, (stops) => stops > 0)
        expect(yield* simulator.stops).toBe(1)
      })
    )
  )

  it.effect("fails an in-flight request as soon as the session ends", () =>
    provided(
      Effect.gen(function* () {
        const simulator = yield* makeSimulator({ endpoint, silent: true })
        const connection = yield* makeDeviceConnection({
          id: DeviceId.make("tool-1"),
          endpoint,
          responseTimeout: Duration.minutes(5)
        })
        yield* awaitState(connection.state, "Ready")

        // The controller never answers, so this request would sit for five
        // minutes if the session did not fail its waiters on the way out.
        const pending = yield* Effect.forkChild(Effect.result(connection.request(new KeepAlive(), 9999, "KeepAlive")))
        yield* Effect.yieldNow
        yield* simulator.drop

        const outcome = yield* Fiber.join(pending)
        expect(outcome._tag).toBe("Failure")
      })
    )
  )

  it.effect("is safe to close twice and refuses later work", () =>
    provided(
      Effect.gen(function* () {
        const simulator = yield* makeSimulator({ endpoint })
        const connection = yield* makeDeviceConnection({ id: DeviceId.make("tool-1"), endpoint })
        yield* awaitState(connection.state, "Ready")

        yield* connection.close
        const again = yield* Effect.result(connection.close)
        const request = yield* Effect.result(connection.send(new KeepAlive()))

        expect(again._tag).toBe("Success")
        expect(request._tag).toBe("Failure")
        yield* settle(simulator.isSubscribed, (subscribed) => !subscribed)
        expect(yield* simulator.isSubscribed).toBe(false)
      })
    )
  )
})
