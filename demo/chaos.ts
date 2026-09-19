/**
 * The chaos demo: N simulated controllers, one pool, random faults, and a
 * summary a reviewer can check at a glance.
 *
 * The claim this project makes is "no tightening result is lost and none is
 * delivered twice". This demo is how that claim is verified without a tool on
 * the desk: everything is seeded, so a failing run can be replayed exactly.
 *
 * ```sh
 * bun run demo -- --seed 7 --duration 20 --devices 3 --fault-rate 0.2
 * ```
 *
 * @since 0.0.0
 */
import { Command, Flag } from "effect/unstable/cli"
import { Duration, Effect, pipe, Predicate, Random, Ref, Schedule } from "effect"
import * as A from "effect/Array"
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import * as Faults from "../simulator/Faults.ts"
import { make as makeSimulator, type Simulator } from "../simulator/ControllerSimulator.ts"
import { DevicePool, layer as devicePoolLayer } from "../src/pool/DevicePool.ts"
import { DeviceId, type TighteningResult } from "../src/protocol/TighteningResult.ts"
import { layerSimulated } from "../simulator/SimulatorNetwork.ts"
import { Endpoint } from "../src/transport/Transport.ts"

interface Tally {
  readonly delivered: ReadonlyArray<string>
  readonly duplicates: number
}

const pad = (value: string, width: number): string => value + " ".repeat(Math.max(0, width - value.length))

const line = (label: string, value: string | number): string => `${pad(label, 26)}${value}`

/**
 * Waits until every generated result has been delivered, or until the settle
 * window closes. Polling keeps the demo honest: it never asserts on a run that
 * is still in flight.
 */
const settle = (
  simulators: ReadonlyArray<Simulator>,
  tally: Ref.Ref<Tally>,
  within: Duration.Duration
): Effect.Effect<void> => {
  const counts = Effect.all({
    generated: Effect.map(
      Effect.forEach(simulators, (simulator) => simulator.generated),
      (values) => A.reduce(values, 0, (sum, value) => sum + value)
    ),
    delivered: Effect.map(Ref.get(tally), (current) => A.length(A.dedupe(current.delivered)))
  })

  const loop = (remaining: number): Effect.Effect<void> =>
    remaining <= 0
      ? Effect.void
      : Effect.flatMap(counts, ({ delivered, generated }) =>
          delivered >= generated ? Effect.void : Effect.andThen(Effect.sleep(Duration.millis(200)), loop(remaining - 1))
        )

  return loop(Math.max(1, Math.ceil(Duration.toMillis(within) / 200)))
}

const runChaos = Effect.fnUntraced(function* (options: {
  readonly seed: number
  readonly duration: Duration.Duration
  readonly devices: number
  readonly faultRate: number
  readonly resultInterval: Duration.Duration
  readonly settleTimeout: Duration.Duration
}) {
  const tally = yield* Ref.make<Tally>({ delivered: [], duplicates: 0 })

  const onResult = (result: TighteningResult) =>
    Ref.update(tally, (current) => ({
      ...current,
      delivered: A.append(current.delivered, `${result.deviceId}:${result.tighteningId}`)
    }))

  const pool = yield* DevicePool

  const simulators = yield* Effect.forEach(A.range(1, options.devices), (index) =>
    Effect.gen(function* () {
      const endpoint = new Endpoint({ host: "chaos", port: 4500 + index })

      const simulator = yield* makeSimulator({
        endpoint,
        controllerName: `Controller-${index}`,
        resultInterval: options.resultInterval,
        ackTimeout: Duration.seconds(2),
        ackAttempts: 3,
        faults: new Faults.FaultConfig({ rate: options.faultRate })
      })

      yield* pool.add({
        id: DeviceId.make(`tool-${index}`),
        endpoint,
        onResult,
        reconnect: Schedule.spaced(Duration.millis(250))
      })

      return simulator
    })
  )

  yield* Effect.logInfo("chaos run started").pipe(
    Effect.annotateLogs({
      seed: options.seed,
      devices: options.devices,
      faultRate: options.faultRate,
      duration: Duration.format(options.duration)
    })
  )

  yield* Effect.sleep(options.duration)

  // Chaos over: stop the faults and the result generator, then let the pool
  // reconnect and recover before the invariant is judged.
  yield* Effect.forEach(simulators, (simulator: Simulator) => simulator.quiesce, { discard: true })
  yield* Effect.logInfo("chaos phase over, letting the run settle")
  yield* settle(simulators, tally, options.settleTimeout)

  const status = yield* pool.status

  const totals = yield* Effect.forEach(simulators, (simulator: Simulator) =>
    Effect.all({ generated: simulator.generated, abandoned: simulator.abandoned })
  )

  const generated = A.reduce(totals, 0, (sum, device) => sum + device.generated)
  const abandoned = A.reduce(totals, 0, (sum, device) => sum + A.length(device.abandoned))
  const current = yield* Ref.get(tally)
  const unique = A.dedupe(current.delivered)
  const duplicates = A.reduce(status, 0, (sum, device) => sum + device.duplicates)

  const reconnects = A.reduce(
    status,
    0,
    (sum, device) => sum + (Predicate.isTagged(device.state, "WaitingToReconnect") ? device.state.attempt : 0)
  )

  const lost = generated - A.length(unique)

  yield* Effect.sync(() => {
    console.log("")
    console.log(line("Devices:", options.devices))
    console.log(line("Seed:", options.seed))
    console.log(line("Results generated:", generated))
    console.log(line("Results delivered:", A.length(unique)))
    console.log(line("Duplicates discarded:", duplicates))
    console.log(line("Abandoned by controller:", abandoned))
    console.log(line("Reconnects pending:", reconnects))
    console.log(line("Results lost:", `${lost}${lost === 0 ? "   OK" : "   FAILED"}`))
    console.log(
      line(
        "Delivered twice:",
        `${A.length(current.delivered) - A.length(unique)}${
          A.length(current.delivered) === A.length(unique) ? "   OK" : "   FAILED"
        }`
      )
    )
    console.log("")
  })

  return lost === 0 && A.length(current.delivered) === A.length(unique)
})

const seed = Flag.Int("seed").pipe(
  Flag.withDescription("Seed for every random decision, so a run can be replayed"),
  Flag.withDefault(1)
)

const duration = Flag.Int("duration").pipe(Flag.withDescription("How many seconds to run"), Flag.withDefault(20))

const devices = Flag.Int("devices").pipe(
  Flag.withDescription("How many simulated controllers to run"),
  Flag.withDefault(3)
)

const faultRate = Flag.Finite("fault-rate").pipe(
  Flag.withDescription("Probability that a given message triggers a fault"),
  Flag.withDefault(0.15)
)

const settleFlag = Flag.Int("settle").pipe(
  Flag.withDescription("Seconds allowed for the run to settle once the faults stop"),
  Flag.withDefault(30)
)

const command = Command.make("chaos", { seed, duration, devices, faultRate, settle: settleFlag }, (config) =>
  pipe(
    runChaos({
      seed: config.seed,
      duration: Duration.seconds(config.duration),
      devices: config.devices,
      faultRate: config.faultRate,
      resultInterval: Duration.millis(200),
      settleTimeout: Duration.seconds(config.settle)
    }),
    Random.withSeed(config.seed),
    Effect.flatMap((passed) => (passed ? Effect.void : Effect.die("the chaos run lost or duplicated a result"))),
    Effect.scoped,
    Effect.provide(devicePoolLayer),
    Effect.provide(layerSimulated)
  )
).pipe(Command.withDescription("Run N simulated controllers under random faults and check the invariant"))

Command.run(command, { version: "0.0.0" }).pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain)
