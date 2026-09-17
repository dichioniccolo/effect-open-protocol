import { describe, expect, it } from "@effect/vitest"
import { Duration, Effect, pipe, Ref, Schedule, Stream, SubscriptionRef } from "effect"
import * as A from "effect/Array"
import * as Str from "effect/String"
import { make as makeSimulator } from "../../simulator/ControllerSimulator.ts"
import type { ConnectionState } from "../../src/connection/ConnectionState.ts"
import type { DeviceConnectionShape } from "../../src/connection/DeviceConnection.ts"
import { DeviceId, type TighteningResult } from "../../src/protocol/TighteningResult.ts"
import { InMemoryNetwork, layer as layerInMemory } from "../../src/transport/InMemoryTransport.ts"
import { Endpoint } from "../../src/transport/Transport.ts"
import { DevicePool } from "../../src/pool/DevicePool.ts"

const toolOne = DeviceId.make("tool-1")
const toolTwo = DeviceId.make("tool-2")
const endpointOne = new Endpoint({ host: "sim", port: 4545 })
const endpointTwo = new Endpoint({ host: "sim", port: 4546 })
const missing = new Endpoint({ host: "sim", port: 9999 })

const provided = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.scoped(effect).pipe(
    Effect.provide(DevicePool.layer),
    Effect.provide(layerInMemory),
    Effect.provide(InMemoryNetwork.layer)
  )

const awaitReady = (connection: DeviceConnectionShape): Effect.Effect<ConnectionState> =>
  pipe(
    SubscriptionRef.changes(connection.state),
    Stream.filter((current) => current._tag === "Ready"),
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

describe("DevicePool", () => {
  it.effect("runs several devices at once", () =>
    provided(Effect.gen(function* () {
      yield* makeSimulator({ endpoint: endpointOne, controllerName: "one" })
      yield* makeSimulator({ endpoint: endpointTwo, controllerName: "two" })
      const pool = yield* DevicePool

      const first = yield* pool.add({ id: toolOne, endpoint: endpointOne })
      const second = yield* pool.add({ id: toolTwo, endpoint: endpointTwo })
      yield* awaitReady(first)
      yield* awaitReady(second)

      const status = yield* pool.status
      expect(A.length(status)).toBe(2)
      expect(A.every(status, (device) => device.state._tag === "Ready")).toBe(true)
    })))

  it.effect("keeps a failing device from affecting the others", () =>
    provided(Effect.gen(function* () {
      yield* makeSimulator({ endpoint: endpointOne })
      const pool = yield* DevicePool

      const healthy = yield* pool.add({ id: toolOne, endpoint: endpointOne })
      const broken = yield* pool.add({
        id: toolTwo,
        endpoint: missing,
        reconnect: Schedule.spaced(Duration.seconds(1))
      })
      yield* awaitReady(healthy)

      const brokenState = yield* settle(
        SubscriptionRef.get(broken.state),
        (current) => current._tag === "WaitingToReconnect"
      )
      expect(brokenState._tag).toBe("WaitingToReconnect")
      expect((yield* SubscriptionRef.get(healthy.state))._tag).toBe("Ready")
    })))

  it.effect("refuses to add the same device twice", () =>
    provided(Effect.gen(function* () {
      yield* makeSimulator({ endpoint: endpointOne })
      const pool = yield* DevicePool
      yield* pool.add({ id: toolOne, endpoint: endpointOne })

      const again = yield* Effect.result(pool.add({ id: toolOne, endpoint: endpointOne }))

      expect(again._tag).toBe("Failure")
    })))

  it.effect("stops a device on remove and forgets it", () =>
    provided(Effect.gen(function* () {
      yield* makeSimulator({ endpoint: endpointOne })
      const pool = yield* DevicePool
      const connection = yield* pool.add({ id: toolOne, endpoint: endpointOne })
      yield* awaitReady(connection)

      yield* pool.remove(toolOne)
      yield* settle(pool.status, (status) => A.length(status) === 0)

      expect(A.fromIterable(yield* pool.status)).toEqual([])
      expect((yield* pool.get(toolOne))._tag).toBe("None")
    })))

  it.effect("delivers results per device", () =>
    provided(Effect.gen(function* () {
      const first = yield* makeSimulator({ endpoint: endpointOne })
      const second = yield* makeSimulator({ endpoint: endpointTwo })
      const received = yield* Ref.make<ReadonlyArray<string>>([])
      const onResult = (result: TighteningResult) =>
        Ref.update(received, (current) => A.append(current, `${result.deviceId}:${result.tighteningId}`))
      const pool = yield* DevicePool

      const one = yield* pool.add({ id: toolOne, endpoint: endpointOne, onResult })
      const two = yield* pool.add({ id: toolTwo, endpoint: endpointTwo, onResult })
      yield* awaitReady(one)
      yield* awaitReady(two)

      yield* first.produce
      yield* second.produce
      const all = yield* settle(Ref.get(received), (current) => A.length(current) === 2)

      expect(A.sort(all, Str.Order)).toEqual([
        "tool-1:1",
        "tool-2:1"
      ])
    })))
})
