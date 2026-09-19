import { describe, expect, it } from "@effect/vitest"
import {
  Context,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  pipe,
  Predicate,
  Ref,
  Result,
  Scope,
  Stream,
  SubscriptionRef
} from "effect"
import * as A from "effect/Array"
import * as O from "effect/Option"
import * as ControllerSimulator from "../../simulator/ControllerSimulator.ts"
import type { ConnectionState } from "../../src/connection/ConnectionState.ts"
import * as DeviceConnection from "../../src/connection/DeviceConnection.ts"
import * as DevicePool from "../../src/pool/DevicePool.ts"
import { KeepAliveMid } from "../../src/protocol/Messages.ts"
import { DeviceId, type TighteningResult } from "../../src/protocol/TighteningResult.ts"
import { layerSimulated } from "../../simulator/SimulatorNetwork.ts"
import { Endpoint } from "../../src/transport/Transport.ts"

const endpoint = new Endpoint({ host: "shutdown", port: 4545 })

const provided = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.provide(Effect.scoped(effect), layerSimulated)

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
        const simulator = yield* ControllerSimulator.make({ endpoint })
        const scope = yield* Scope.make()

        const connection = yield* Scope.provide(
          DeviceConnection.make({ id: DeviceId.make("tool-1"), endpoint, onResult: () => Effect.void }),
          scope
        )

        yield* awaitState(connection.state, "Ready")
        expect(yield* simulator.isSubscribed).toBe(true)

        yield* Scope.close(scope, Exit.void)

        yield* settle(simulator.isSubscribed, (subscribed) => !subscribed)
        expect(yield* simulator.isSubscribed).toBe(false)
        expect(Predicate.isTagged(yield* SubscriptionRef.get(connection.state), "Closed")).toBe(true)
      })
    )
  )

  it.effect("stops delivering once the pool is closed", () =>
    provided(
      Effect.gen(function* () {
        const received = yield* Ref.make<ReadonlyArray<number>>([])
        const simulator = yield* ControllerSimulator.make({ endpoint })
        const scope = yield* Scope.make()

        const pool = yield* Scope.provide(
          Effect.map(Layer.build(DevicePool.layer), (context) => Context.get(context, DevicePool.DevicePool)),
          scope
        )

        const connection = yield* pool.add({
          id: DeviceId.make("tool-1"),
          endpoint,
          onResult: (result: TighteningResult) =>
            Ref.update(received, (current) => A.append(current, result.tighteningId))
        })

        yield* awaitState(connection.state, "Ready")
        yield* simulator.produce
        yield* settle(Ref.get(received), (current) => A.length(current) === 1)

        yield* Scope.close(scope, Exit.void)
        yield* settle(simulator.isSubscribed, (subscribed) => !subscribed)
        yield* simulator.produce
        yield* Effect.yieldNow
        yield* Effect.yieldNow

        expect(yield* Ref.get(received)).toEqual([1])
        expect(Predicate.isTagged(yield* SubscriptionRef.get(connection.state), "Closed")).toBe(true)
      })
    )
  )

  it.effect("says goodbye with a communication stop before closing", () =>
    provided(
      Effect.gen(function* () {
        const simulator = yield* ControllerSimulator.make({ endpoint })
        const connection = yield* DeviceConnection.make({ id: DeviceId.make("tool-1"), endpoint })
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
        const simulator = yield* ControllerSimulator.make({ endpoint, silent: true })

        const connection = yield* DeviceConnection.make({
          id: DeviceId.make("tool-1"),
          endpoint,
          responseTimeout: Duration.minutes(5)
        })

        yield* awaitState(connection.state, "Ready")

        // The controller never answers, so this request would sit for five
        // minutes if the session did not fail its waiters on the way out.
        const pending = yield* Effect.forkChild(Effect.result(connection.request(KeepAliveMid.rev(1), {})))
        yield* Effect.yieldNow
        yield* simulator.drop

        const outcome = yield* Fiber.join(pending)
        expect(Result.isFailure(outcome)).toBe(true)
      })
    )
  )

  it.effect("is safe to close twice and refuses later work", () =>
    provided(
      Effect.gen(function* () {
        const simulator = yield* ControllerSimulator.make({ endpoint })
        const connection = yield* DeviceConnection.make({ id: DeviceId.make("tool-1"), endpoint })
        yield* awaitState(connection.state, "Ready")

        yield* connection.close
        const again = yield* Effect.result(connection.close)
        const request = yield* Effect.result(connection.send(KeepAliveMid.rev(1), {}))

        expect(Result.isSuccess(again)).toBe(true)
        expect(Result.isFailure(request)).toBe(true)
        yield* settle(simulator.isSubscribed, (subscribed) => !subscribed)
        expect(yield* simulator.isSubscribed).toBe(false)
      })
    )
  )
})
