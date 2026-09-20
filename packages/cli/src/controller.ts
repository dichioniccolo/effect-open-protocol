/**
 * A simulated controller on a real TCP port, narrating everything it says.
 *
 * ```sh
 * bun run controller -- --port 4545 --result-interval 2000 --fault-rate 0.2
 * ```
 *
 * It behaves like the controllers the library talks to: it answers the
 * handshake, accepts a subscription, pushes results and waits for MID 0062,
 * serves MID 0064 from its store, and misbehaves on demand.
 *
 * Three commands on stdin drive it by hand, each one a line ending with Enter.
 * Enter alone produces one result immediately. `d` takes the link down,
 * dropping the open connection and refusing new ones the way a rebooting
 * controller does. `u` brings it back.
 * Together they are the outage this library exists for: take the link down,
 * produce a result the client cannot receive, bring it up, and watch the
 * client fetch it with MID 0064. Ctrl-C prints what the controller produced.
 *
 * @since 0.0.0
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Duration, Effect, Match, pipe, Random, Ref, Stdio, Stream } from "effect"
import * as A from "effect/Array"
import * as Str from "effect/String"
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

const decoder = new TextDecoder()

/**
 * Runs the commands typed on stdin.
 *
 * Lines, not keypresses: reading keys would put the terminal in raw mode, and a
 * raw terminal turns Ctrl-C into a keystroke instead of a signal. Keeping the
 * terminal cooked leaves `runMain` owning Ctrl-C, which is the only thing that
 * stops this command.
 *
 * Stdin that is closed or not a terminal simply never produces anything.
 */
const onCommand = (simulator: ControllerSimulator.Simulator): Effect.Effect<void, never, Stdio.Stdio> =>
  Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio
    const partial = yield* Ref.make("")

    const produceOne = pipe(
      simulator.produce,
      Effect.flatMap((result) =>
        Effect.logInfo("produced a result on request").pipe(Effect.annotateLogs({ tighteningId: result.tighteningId }))
      )
    )

    // A dropped connection alone would let the client straight back in on its
    // next attempt, so the endpoint stops accepting too. Together they are a
    // controller that went away, which is what an outage looks like from here.
    const takeDown = pipe(
      simulator.refuse(true),
      Effect.andThen(simulator.drop),
      Effect.andThen(Effect.logInfo("link down: connection dropped, new ones refused"))
    )

    const bringUp = pipe(
      simulator.refuse(false),
      Effect.andThen(Effect.logInfo("link up: accepting connections again"))
    )

    const run = (line: string): Effect.Effect<void> =>
      Match.value(Str.toLowerCase(Str.trim(line))).pipe(
        Match.when("", () => produceOne),
        Match.when("d", () => takeDown),
        Match.when("u", () => bringUp),
        Match.orElse((other) =>
          Effect.logInfo("unknown command, expected Enter, d or u").pipe(Effect.annotateLogs({ typed: other }))
        )
      )

    /** The lines a chunk completed, with whatever it left half-typed kept for the next one. */
    const lines = (chunk: Uint8Array): Effect.Effect<ReadonlyArray<string>> =>
      Ref.modify(partial, (held) => {
        const parts = Str.split(held + decoder.decode(chunk), "\n")

        return [A.dropRight(parts, 1), A.lastNonEmpty(parts)]
      })

    return yield* pipe(
      Stream.runForEach(stdio.stdin, (chunk) =>
        Effect.flatMap(lines(chunk), (completed) => Effect.forEach(completed, run, { discard: true }))
      ),
      Effect.catchCause((cause) => Effect.logDebug("stdin closed, no commands", cause))
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

  yield* Effect.logInfo(
    "type a command and press Enter: nothing produces a result, d takes the link down, u brings it back"
  )

  // The line reader runs on its own fiber, so the main fiber is parked on an
  // interruptible hold and Ctrl-C reaches it.
  yield* Effect.forkChild(onCommand(simulator))

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
