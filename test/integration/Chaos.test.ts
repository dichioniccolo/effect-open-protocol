import { describe, expect, it } from "@effect/vitest"
import { Duration, Effect, Random, Ref, Schedule } from "effect"
import * as A from "effect/Array"
import { make as makeSimulator, type Simulator } from "../../simulator/ControllerSimulator.ts"
import { make as makePool } from "../../src/pool/DevicePool.ts"
import { DeviceId, type TighteningResult } from "../../src/protocol/TighteningResult.ts"
import { layer as layerInMemory, layerNetwork } from "../../src/transport/InMemoryTransport.ts"
import { Endpoint } from "../../src/transport/Transport.ts"

/**
 * The invariant the whole project exists for, checked automatically: under
 * seeded faults, every tightening result reaches the handler exactly once.
 */
const runChaos = (options: {
  readonly seed: number
  readonly devices: number
  readonly faultRate: number
}) =>
  Effect.gen(function* () {
    const delivered = yield* Ref.make<ReadonlyArray<string>>([])
    const onResult = (result: TighteningResult) =>
      Ref.update(delivered, (current) => A.append(current, `${result.deviceId}:${result.tighteningId}`))

    const pool = yield* makePool()
    const simulators = yield* Effect.forEach(A.range(1, options.devices), (index) =>
      Effect.gen(function* () {
        const endpoint = new Endpoint({ host: `chaos-${options.seed}`, port: 4600 + index })
        const simulator = yield* makeSimulator({
          endpoint,
          controllerName: `Controller-${index}`,
          resultInterval: Duration.millis(100),
          ackTimeout: Duration.seconds(1),
          ackAttempts: 3,
          faults: { rate: options.faultRate, maxDelay: Duration.seconds(2), maxOutage: Duration.seconds(2) }
        })
        yield* pool.add({
          id: DeviceId.make(`tool-${index}`),
          endpoint,
          onResult,
          reconnect: Schedule.spaced(Duration.millis(100))
        })
        return simulator
      }))

    yield* Effect.sleep(Duration.seconds(2))
    yield* Effect.forEach(simulators, (simulator: Simulator) => simulator.quiesce, { discard: true })

    const generated = Effect.map(
      Effect.forEach(simulators, (simulator: Simulator) => simulator.generated),
      (counts) => A.reduce(counts, 0, (sum, value) => sum + value)
    )
    const settle = (remaining: number): Effect.Effect<void> =>
      remaining <= 0
        ? Effect.void
        : Effect.flatMap(
          Effect.all({ generated, delivered: Ref.get(delivered) }),
          (current) =>
            A.length(A.dedupe(current.delivered)) >= current.generated
              ? Effect.void
              : Effect.andThen(Effect.sleep(Duration.millis(100)), settle(remaining - 1))
        )
    yield* settle(200)

    return yield* Effect.all({ generated, delivered: Ref.get(delivered) })
  }).pipe(
    Random.withSeed(options.seed),
    Effect.scoped,
    Effect.provide(layerInMemory),
    Effect.provide(layerNetwork)
  )

describe("chaos invariant", () => {
  it.live("loses nothing and delivers nothing twice", () =>
    Effect.gen(function* () {
      const outcome = yield* runChaos({ seed: 7, devices: 2, faultRate: 0.2 })

      const unique = A.dedupe(outcome.delivered)
      expect(outcome.generated).toBeGreaterThan(0)
      expect(A.length(unique)).toBe(outcome.generated)
      expect(A.length(outcome.delivered)).toBe(A.length(unique))
    }), 60_000)

  it.live("holds for a different seed", () =>
    Effect.gen(function* () {
      const outcome = yield* runChaos({ seed: 1234, devices: 3, faultRate: 0.3 })

      const unique = A.dedupe(outcome.delivered)
      expect(A.length(unique)).toBe(outcome.generated)
      expect(A.length(outcome.delivered)).toBe(A.length(unique))
    }), 60_000)
})
