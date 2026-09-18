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
import * as O from "effect/Option"
import { Command, Flag } from "effect/unstable/cli"
import { makeWith, type Simulator } from "../simulator/ControllerSimulator.ts"
import { makeTcpListener } from "../simulator/TcpListener.ts"
import { Endpoint } from "../src/transport/Transport.ts"
import { host, instrument, jitter, latency, latencyOf, port, seed, traceDb, traceFile, traceSink } from "./Wire.ts"
import { makeRecording } from "./Recording.ts"

const faultRate = Flag.Finite("fault-rate").pipe(
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
const onEnter = (simulator: Simulator): Effect.Effect<void, never, Stdio.Stdio> =>
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
          : Effect.forEach(A.range(1, newlines(chunk)), () => produceOne, { discard: true })
      ),
      Effect.catchCause((cause) => Effect.logDebug("stdin closed, no result trigger", cause))
    )
  })

const summary = (simulator: Simulator): Effect.Effect<void> =>
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

const run = Effect.fnUntraced(function* (config: {
  readonly host: string
  readonly port: number
  readonly seed: number
  readonly latency: number
  readonly jitter: number
  readonly traceFile: O.Option<string>
  readonly traceDb: string
  readonly faultRate: number
  readonly resultInterval: number
  readonly controllerName: string
}) {
  const endpoint = new Endpoint({ host: config.host, port: config.port })
  const recording = yield* makeRecording({
    traceDb: config.traceDb,
    file: yield* traceSink(config.traceFile),
    start: {
      side: "controller",
      host: config.host,
      port: config.port,
      seed: config.seed,
      latency: config.latency,
      jitter: config.jitter
    }
  })
  const link = latencyOf(config)

  const listener = yield* makeTcpListener({
    endpoint,
    decorate: (side) =>
      Effect.map(instrument(side, { source: "controller", recording, latency: link }), (wrapped) => ({
        ...wrapped,
        close: side.close
      }))
  })

  const simulator = yield* makeWith(
    {
      endpoint,
      controllerName: config.controllerName,
      ...(config.resultInterval > 0 ? { resultInterval: Duration.millis(config.resultInterval) } : {}),
      ...(config.faultRate > 0 ? { faults: { rate: config.faultRate } } : {})
    },
    Effect.succeed(listener.accept),
    listener.refuse
  )

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

const command = Command.make(
  "controller",
  { host, port, seed, latency, jitter, traceFile, traceDb, faultRate, resultInterval, controllerName },
  (config) => pipe(run(config), Random.withSeed(config.seed), Effect.scoped, Effect.asVoid)
).pipe(Command.withDescription("Serve a simulated Open Protocol controller and trace every byte it exchanges"))

Command.run(command, { version: "0.0.0" }).pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain)
