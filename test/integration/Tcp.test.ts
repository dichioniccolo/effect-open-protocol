import { describe, expect, it } from "@effect/vitest"
import { Duration, Effect, pipe, Predicate, Ref, Stream, SubscriptionRef } from "effect"
import * as A from "effect/Array"
import * as O from "effect/Option"
import { make as makeSimulator } from "../../simulator/ControllerSimulator.ts"
import { layer as simulatorOnTcp } from "../../simulator/TcpListener.ts"
import { make as makeConnection } from "../../src/connection/DeviceConnection.ts"
import { DeviceId, type TighteningResult } from "../../src/protocol/TighteningResult.ts"
import { layer as layerTcp } from "../../src/transport/TcpTransport.ts"
import { Endpoint } from "../../src/transport/Transport.ts"

const deviceId = DeviceId.make("tcp-tool")

const endpoint = new Endpoint({ host: "127.0.0.1", port: 45455 })

/**
 * Waits on real time: this is the one test that talks to a socket, so the
 * event loop must get a chance to run between checks.
 */
const settle = <A>(effect: Effect.Effect<A>, predicate: (value: A) => boolean, attempts = 100): Effect.Effect<A> =>
  Effect.flatMap(effect, (value) =>
    predicate(value) || attempts <= 0
      ? Effect.succeed(value)
      : Effect.andThen(Effect.sleep(Duration.millis(20)), settle(effect, predicate, attempts - 1))
  )

describe("real TCP smoke test", () => {
  it.live(
    "connects, subscribes and delivers a result over a socket",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const simulator = yield* makeSimulator({ endpoint, controllerName: "TcpSim" })
          const received = yield* Ref.make<ReadonlyArray<number>>([])

          const connection = yield* makeConnection({
            id: deviceId,
            endpoint,
            onResult: (result: TighteningResult) =>
              Ref.update(received, (current) => A.append(current, result.tighteningId))
          })

          const ready = yield* pipe(
            SubscriptionRef.changes(connection.state),
            Stream.filter((current) => Predicate.isTagged(current, "Ready")),
            Stream.runHead
          )

          expect(O.isSome(ready)).toBe(true)

          yield* simulator.produce
          const results = yield* settle(Ref.get(received), (current) => A.length(current) === 1)

          expect(results).toEqual([1])
          expect(yield* connection.delivered).toBe(1)
        })
      ).pipe(Effect.provide([layerTcp, simulatorOnTcp()])),
    30_000
  )
})
