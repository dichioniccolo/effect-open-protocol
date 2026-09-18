/**
 * Runs the chaos scenario over many seeds and reports the ones that break the
 * invariant.
 *
 * The chaos test in the suite covers two seeds, which proves the mechanism but
 * not its odds. This walks a range of seeds, varies the device count and the
 * fault rate as it goes, and prints every seed that lost or duplicated a
 * result so it can be replayed with `bun run demo -- --seed <n>`.
 *
 * ```sh
 * bun run scripts/soak.ts --seeds 50 --duration 1500
 * ```
 *
 * @since 0.0.0
 */
import { NodeRuntime } from "@effect/platform-node"
import { Duration, Effect, Random, Ref, Schedule } from "effect"
import * as A from "effect/Array"
import { make as makeSimulator, type Simulator } from "../simulator/ControllerSimulator.ts"
import { DevicePool } from "../src/pool/DevicePool.ts"
import { DeviceId, type TighteningResult } from "../src/protocol/TighteningResult.ts"
import { layerComplete } from "../src/transport/InMemoryTransport.ts"
import { Endpoint } from "../src/transport/Transport.ts"

interface Outcome {
  readonly seed: number
  readonly devices: number
  readonly faultRate: number
  readonly generated: number
  readonly delivered: number
  readonly unique: number
  readonly abandoned: number
}

const lost = (outcome: Outcome): number => outcome.generated - outcome.unique

const duplicated = (outcome: Outcome): number => outcome.delivered - outcome.unique

const passed = (outcome: Outcome): boolean => lost(outcome) === 0 && duplicated(outcome) === 0

const runOnce = (options: {
  readonly seed: number
  readonly devices: number
  readonly faultRate: number
  readonly duration: Duration.Duration
  readonly settle: Duration.Duration
}) =>
  Effect.gen(function* () {
    const delivered = yield* Ref.make<ReadonlyArray<string>>([])
    const pool = yield* DevicePool
    const simulators = yield* Effect.forEach(A.range(1, options.devices), (index) =>
      Effect.gen(function* () {
        const endpoint = new Endpoint({ host: `soak-${options.seed}`, port: 4700 + index })
        const simulator = yield* makeSimulator({
          endpoint,
          controllerName: `Controller-${index}`,
          resultInterval: Duration.millis(100),
          ackTimeout: Duration.seconds(1),
          ackAttempts: 3,
          faults: {
            rate: options.faultRate,
            maxDelay: Duration.seconds(2),
            maxOutage: Duration.seconds(2)
          }
        })
        yield* pool.add({
          id: DeviceId.make(`tool-${index}`),
          endpoint,
          reconnect: Schedule.spaced(Duration.millis(100)),
          onResult: (result: TighteningResult) =>
            Ref.update(delivered, (current) => A.append(current, `${result.deviceId}:${result.tighteningId}`))
        })
        return simulator
      })
    )

    yield* Effect.sleep(options.duration)
    yield* Effect.forEach(simulators, (simulator: Simulator) => simulator.quiesce, { discard: true })

    const generated = Effect.map(
      Effect.forEach(simulators, (simulator: Simulator) => simulator.generated),
      (counts) => A.reduce(counts, 0, (sum, value) => sum + value)
    )

    const settleFor = (remaining: number): Effect.Effect<void> =>
      remaining <= 0
        ? Effect.void
        : Effect.flatMap(Effect.all({ generated, delivered: Ref.get(delivered) }), (current) =>
            A.length(A.dedupe(current.delivered)) >= current.generated
              ? Effect.void
              : Effect.andThen(Effect.sleep(Duration.millis(100)), settleFor(remaining - 1))
          )
    yield* settleFor(Math.ceil(Duration.toMillis(options.settle) / 100))

    const abandoned = yield* Effect.map(
      Effect.forEach(simulators, (simulator: Simulator) => simulator.abandoned),
      (lists) => A.reduce(lists, 0, (sum, list) => sum + A.length(list))
    )
    const finalGenerated = yield* generated
    const finalDelivered = yield* Ref.get(delivered)

    return {
      seed: options.seed,
      devices: options.devices,
      faultRate: options.faultRate,
      generated: finalGenerated,
      delivered: A.length(finalDelivered),
      unique: A.length(A.dedupe(finalDelivered)),
      abandoned
    } satisfies Outcome
  }).pipe(Random.withSeed(options.seed), Effect.scoped, Effect.provide(DevicePool.layer), Effect.provide(layerComplete))

const flag = (name: string, fallback: number): number => {
  const index = A.findFirstIndex(process.argv, (value) => value === `--${name}`)
  return index._tag === "Some" ? Number(process.argv[index.value + 1] ?? fallback) : fallback
}

const program = Effect.gen(function* () {
  const seeds = flag("seeds", 50)
  const duration = Duration.millis(flag("duration", 1500))
  const settle = Duration.seconds(flag("settle", 15))

  yield* Effect.logInfo(`soak starting: ${seeds} seeds`)

  const outcomes = yield* Effect.forEach(A.range(1, seeds), (seed) =>
    Effect.tap(
      runOnce({
        seed,
        // Walk the interesting range rather than one configuration.
        devices: 1 + (seed % 3),
        faultRate: 0.1 + (seed % 4) * 0.1,
        duration,
        settle
      }),
      (outcome) =>
        Effect.sync(() =>
          console.log(
            `seed ${`${outcome.seed}`.padStart(4)}  devices ${outcome.devices}  faults ${outcome.faultRate.toFixed(
              2
            )}  generated ${`${outcome.generated}`.padStart(4)}  delivered ${`${outcome.unique}`.padStart(
              4
            )}  abandoned ${`${outcome.abandoned}`.padStart(3)}  ${passed(outcome) ? "ok" : "FAILED"}`
          )
        )
    )
  )

  const failures = A.filter(outcomes, (outcome) => !passed(outcome))
  const totalGenerated = A.reduce(outcomes, 0, (sum, outcome) => sum + outcome.generated)
  const totalAbandoned = A.reduce(outcomes, 0, (sum, outcome) => sum + outcome.abandoned)

  yield* Effect.sync(() => {
    console.log("")
    console.log(`runs:              ${A.length(outcomes)}`)
    console.log(`results generated: ${totalGenerated}`)
    console.log(`abandoned by ctrl: ${totalAbandoned}`)
    console.log(`failures:          ${A.length(failures)}`)
    A.forEach(failures, (failure) =>
      console.log(
        `  seed ${failure.seed}: lost ${lost(failure)}, duplicated ${duplicated(failure)} ` +
          `(devices ${failure.devices}, fault rate ${failure.faultRate.toFixed(2)})`
      )
    )
    console.log("")
  })

  return A.length(failures)
}).pipe(
  Effect.flatMap((failures) => (failures === 0 ? Effect.void : Effect.die(`${failures} seeds broke the invariant`)))
)

program.pipe(NodeRuntime.runMain)
