import { describe, expect, it } from "@effect/vitest"
import { Duration, Effect, pipe, Ref, Stream, SubscriptionRef } from "effect"
import * as A from "effect/Array"
import { makeTcp } from "../../simulator/ControllerSimulator.ts"
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
const settle = <A>(
  effect: Effect.Effect<A>,
  predicate: (value: A) => boolean,
  attempts = 100
): Effect.Effect<A> =>
  Effect.flatMap(effect, (value) =>
    predicate(value) || attempts <= 0
      ? Effect.succeed(value)
      : Effect.andThen(Effect.sleep(Duration.millis(20)), settle(effect, predicate, attempts - 1)))

describe("real TCP smoke test", () => {
  it.live("connects, subscribes and delivers a result over a socket", () =>
    Effect.scoped(Effect.gen(function* () {
      const simulator = yield* makeTcp({ endpoint, controllerName: "TcpSim" })
      const received = yield* Ref.make<ReadonlyArray<number>>([])
      const connection = yield* makeConnection({
        id: deviceId,
        endpoint,
        onResult: (result: TighteningResult) =>
          Ref.update(received, (current) => A.append(current, result.tighteningId as number))
      })

      const ready = yield* pipe(
        SubscriptionRef.changes(connection.state),
        Stream.filter((current) => current._tag === "Ready"),
        Stream.runHead
      )
      expect(ready._tag).toBe("Some")

      yield* simulator.produce
      const results = yield* settle(Ref.get(received), (current) => A.length(current) === 1)

      expect(results).toEqual([1])
      expect(yield* connection.delivered).toBe(1)
    })).pipe(Effect.provide(layerTcp)), 30_000)
})
