/**
 * A simulated controller on a real TCP port, narrating everything it says.
 *
 * ```sh
 * bun run controller -- --port 4545 --result-interval 2000 --fault-rate 0.2
 * ```
 *
 * It behaves like the controllers the library talks to: it answers the
 * handshake, accepts a subscription, pushes results and waits for MID 0062,
 * serves MID 0064 from its store, and misbehaves on demand. Press Enter to
 * produce one result immediately, which is how you make a result exist while
 * the link is down and then watch the client recover it. Ctrl-C prints what it
 * produced.
 *
 * @since 0.0.0
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Duration, Effect, pipe, Random, Stdio, Stream } from "effect"
import * as A from "effect/Array"
import { Command, Flag } from "effect/unstable/cli"
import { Endpoint } from "effect-open-protocol"
import * as ControllerSimulator from "effect-open-protocol/simulator/ControllerSimulator.ts"
import * as Faults from "effect-open-protocol/simulator/Faults.ts"
import * as Recording from "./Recording.ts"
import { instrumentedListener, latencyOf, linkFlags } from "./Wire.ts"

const faultRate = Flag.Finite("fault-rate").pipe(
  Flag.withSchema(Faults.FaultRate),
  Flag.withDescription("Probability that a frame this controller sends triggers a fault"),
  Flag.withDefault(0)
)

const resultInterval = Flag.Int("result-interval").pipe(
  Flag.withDescription("Milliseconds between generated tightening results; 0 produces none on a timer"),
  Flag.withDefault(0)
)

const controllerName = Flag.String("controller-name").pipe(
  Flag.withDescription("Name reported in the handshake reply"),
  Flag.withDefault("Simulator")
)

/** How many lines a chunk of stdin completed. */
const newlines = (bytes: Uint8Array): number => A.length(A.filter(A.fromIterable(bytes), (byte) => byte === 10))

/**
 * Produces one result per line on stdin.
 *
 * Lines, not keypresses: reading keys would put the terminal in raw mode, and a
 * raw terminal turns Ctrl-C into a keystroke instead of a signal. Keeping the
 * terminal cooked leaves `runMain` owning Ctrl-C, which is the only thing that
 * stops this command.
 *
 * Stdin that is closed or not a terminal simply never produces anything.
 */
const onEnter = (simulator: ControllerSimulator.Simulator): Effect.Effect<void, never, Stdio.Stdio> =>
  Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio

    const produceOne = pipe(
      simulator.produce,
      Effect.flatMap((result) =>
        Effect.logInfo("produced a result on request").pipe(Effect.annotateLogs({ tighteningId: result.tighteningId }))
      )
    )

    return yield* pipe(
      Stream.runForEach(stdio.stdin, (chunk) =>
        // `A.range(1, 0)` is `[1]`, so an empty count has to be handled here.
        newlines(chunk) === 0
          ? Effect.void
          : Effect.forEach(A.range(1, newlines(chunk)), () => produceOne, {
              discard: true
            })
      ),
      Effect.catchCause((cause) => Effect.logDebug("stdin closed, no result trigger", cause))
    )
  })

const summary = (simulator: ControllerSimulator.Simulator): Effect.Effect<void> =>
  Effect.gen(function* () {
    const generated = yield* simulator.generated
    const abandoned = yield* simulator.abandoned
    const backlog = yield* simulator.backlog
    yield* Effect.logInfo("controller stopped").pipe(
      Effect.annotateLogs({
        generated,
        abandoned: A.length(abandoned),
        abandonedIds: A.join(
          A.map(abandoned, (id) => `${id}`),
          ","
        ),
        backlog
      })
    )
  })

const run = Effect.fnUntraced(function* (
  config: Recording.RecordingConfig & {
    readonly faultRate: number
    readonly resultInterval: number
    readonly controllerName: string
  }
) {
  const endpoint = new Endpoint({ host: config.host, port: config.port })

  const simulator = yield* ControllerSimulator.make({
    endpoint,
    controllerName: config.controllerName,
    resultInterval: config.resultInterval > 0 ? Duration.millis(config.resultInterval) : undefined,
    faults: config.faultRate > 0 ? new Faults.FaultConfig({ rate: config.faultRate }) : undefined
  })

  yield* Effect.logInfo("controller listening").pipe(
    Effect.annotateLogs({
      endpoint: `${config.host}:${config.port}`,
      latency: config.latency,
      jitter: config.jitter,
      faultRate: config.faultRate,
      resultInterval: config.resultInterval
    })
  )

  // The line reader runs on its own fiber, so the main fiber is parked on an
  // interruptible hold and Ctrl-C reaches it.
  yield* Effect.forkChild(onEnter(simulator))

  return yield* Effect.onExit(Effect.never, () => summary(simulator))
})

const command = Command.make("controller", { ...linkFlags, faultRate, resultInterval, controllerName }, (config) =>
  pipe(
    run(config),
    Random.withSeed(config.seed),
    // Every accepted connection is traced and delayed before the simulator
    // sees it; the listener's bindings still belong to this command's scope.
    Effect.provide(instrumentedListener({ source: "controller", latency: latencyOf(config) })),
    Effect.provide(Recording.layer("controller", config)),
    Effect.scoped,
    Effect.asVoid
  )
).pipe(Command.withDescription("Serve a simulated Open Protocol controller and trace every byte it exchanges"))

Command.run(command, { version: "0.0.0" }).pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain)
