import { describe, expect, it } from "@effect/vitest"
import { Duration, Effect, pipe, Predicate, Ref, Result, Schedule, Stream, SubscriptionRef } from "effect"
import * as A from "effect/Array"
import * as O from "effect/Option"
import * as Str from "effect/String"
import * as ControllerSimulator from "../../simulator/ControllerSimulator.ts"
import type { ConnectionState } from "../../src/connection/ConnectionState.ts"
import type { DeviceConnectionService } from "../../src/connection/DeviceConnection.ts"
import { DeviceId, type TighteningResult } from "../../src/protocol/TighteningResult.ts"
import { layerSimulated } from "../../simulator/SimulatorNetwork.ts"
import { Endpoint } from "../../src/transport/Transport.ts"
import * as DevicePool from "../../src/pool/DevicePool.ts"

const toolOne = DeviceId.make("tool-1")

const toolTwo = DeviceId.make("tool-2")

const endpointOne = new Endpoint({ host: "sim", port: 4545 })

const endpointTwo = new Endpoint({ host: "sim", port: 4546 })

const missing = new Endpoint({ host: "sim", port: 9999 })

const provided = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.scoped(effect).pipe(Effect.provide(DevicePool.layer), Effect.provide(layerSimulated))

const awaitReady = (connection: DeviceConnectionService): Effect.Effect<ConnectionState> =>
  pipe(
    SubscriptionRef.changes(connection.state),
    Stream.filter((current) => Predicate.isTagged(current, "Ready")),
    Stream.runHead,
    Effect.flatMap(O.match({ onNone: () => Effect.never, onSome: Effect.succeed }))
  )

const settle = <A>(effect: Effect.Effect<A>, predicate: (value: A) => boolean, attempts = 500): Effect.Effect<A> =>
  Effect.flatMap(effect, (value) =>
    predicate(value) || attempts <= 0
      ? Effect.succeed(value)
      : Effect.andThen(Effect.yieldNow, settle(effect, predicate, attempts - 1))
  )

describe("DevicePool", () => {
  it.effect("runs several devices at once", () =>
    provided(
      Effect.gen(function* () {
        yield* ControllerSimulator.make({ endpoint: endpointOne, controllerName: "one" })
        yield* ControllerSimulator.make({ endpoint: endpointTwo, controllerName: "two" })
        const pool = yield* DevicePool.DevicePool

        const first = yield* pool.add({ id: toolOne, endpoint: endpointOne })
        const second = yield* pool.add({ id: toolTwo, endpoint: endpointTwo })
        yield* awaitReady(first)
        yield* awaitReady(second)

        const status = yield* pool.status
        expect(A.length(status)).toBe(2)
        expect(A.every(status, (device) => Predicate.isTagged(device.state, "Ready"))).toBe(true)
      })
    )
  )

  it.effect("keeps a failing device from affecting the others", () =>
    provided(
      Effect.gen(function* () {
        yield* ControllerSimulator.make({ endpoint: endpointOne })
        const pool = yield* DevicePool.DevicePool

        const healthy = yield* pool.add({ id: toolOne, endpoint: endpointOne })

        const broken = yield* pool.add({
          id: toolTwo,
          endpoint: missing,
          reconnect: Schedule.spaced(Duration.seconds(1))
        })

        yield* awaitReady(healthy)

        const brokenState = yield* settle(SubscriptionRef.get(broken.state), (current) =>
          Predicate.isTagged(current, "WaitingToReconnect")
        )

        expect(Predicate.isTagged(brokenState, "WaitingToReconnect")).toBe(true)
        expect(Predicate.isTagged(yield* SubscriptionRef.get(healthy.state), "Ready")).toBe(true)
      })
    )
  )

  it.effect("refuses to add the same device twice", () =>
    provided(
      Effect.gen(function* () {
        yield* ControllerSimulator.make({ endpoint: endpointOne })
        const pool = yield* DevicePool.DevicePool
        yield* pool.add({ id: toolOne, endpoint: endpointOne })

        const again = yield* Effect.result(pool.add({ id: toolOne, endpoint: endpointOne }))

        expect(Result.isFailure(again)).toBe(true)
      })
    )
  )

  it.effect("lets only one of two concurrent adds of the same device win", () =>
    provided(
      Effect.gen(function* () {
        yield* ControllerSimulator.make({ endpoint: endpointOne })
        const pool = yield* DevicePool.DevicePool

        const both = yield* Effect.all(
          [
            Effect.result(pool.add({ id: toolOne, endpoint: endpointOne })),
            Effect.result(pool.add({ id: toolOne, endpoint: endpointOne }))
          ],
          { concurrency: "unbounded" }
        )

        expect(A.length(A.filter(both, (outcome) => Result.isSuccess(outcome)))).toBe(1)
        expect(A.length(A.filter(both, (outcome) => Result.isFailure(outcome)))).toBe(1)
        expect(A.length(yield* pool.status)).toBe(1)
      })
    )
  )

  it.effect("stops a device on remove and forgets it", () =>
    provided(
      Effect.gen(function* () {
        yield* ControllerSimulator.make({ endpoint: endpointOne })
        const pool = yield* DevicePool.DevicePool
        const connection = yield* pool.add({ id: toolOne, endpoint: endpointOne })
        yield* awaitReady(connection)

        yield* pool.remove(toolOne)
        yield* settle(pool.status, (status) => A.length(status) === 0)

        expect(A.fromIterable(yield* pool.status)).toEqual([])
        expect(O.isNone(yield* pool.get(toolOne))).toBe(true)
      })
    )
  )

  it.effect("delivers results per device", () =>
    provided(
      Effect.gen(function* () {
        const first = yield* ControllerSimulator.make({ endpoint: endpointOne })
        const second = yield* ControllerSimulator.make({ endpoint: endpointTwo })
        const received = yield* Ref.make<ReadonlyArray<string>>([])

        const onResult = (result: TighteningResult) =>
          Ref.update(received, (current) => A.append(current, `${result.deviceId}:${result.tighteningId}`))

        const pool = yield* DevicePool.DevicePool

        const one = yield* pool.add({ id: toolOne, endpoint: endpointOne, onResult })
        const two = yield* pool.add({ id: toolTwo, endpoint: endpointTwo, onResult })
        yield* awaitReady(one)
        yield* awaitReady(two)

        yield* first.produce
        yield* second.produce
        const all = yield* settle(Ref.get(received), (current) => A.length(current) === 2)

        expect(A.sort(all, Str.Order)).toEqual(["tool-1:1", "tool-2:1"])
      })
    )
  )
})
