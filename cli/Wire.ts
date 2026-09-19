/**
 * What the two commands share: the flags that describe a link, and the
 * decorators those flags turn into.
 *
 * Both commands stack the same two `Duplex` decorators over whatever carries
 * their bytes. The tracer logs what crosses the socket; the latency decorator
 * delays what this side writes. Latency sits outside the tracer, so a traced
 * line is stamped when the bytes really go out, not when the program asked.
 *
 * @since 0.0.0
 */
import { Duration, Effect, Layer } from "effect"
import { Flag } from "effect/unstable/cli"
import type { SimulatorNetwork } from "../simulator/SimulatorNetwork.ts"
import { layer as simulatorOnTcp } from "../simulator/TcpListener.ts"
import { type Duplex, Transport } from "../src/transport/Transport.ts"
import { delayedDuplex, type LatencyOptions } from "../src/transport/WireLatency.ts"
import { tracedDuplex } from "../src/transport/WireTrace.ts"
import { Recording, type RecordingService } from "./Recording.ts"

/**
 * Seed for every random decision, so a run can be replayed.
 *
 * @category flags
 * @since 0.0.0
 */
export const seed = Flag.Int("seed").pipe(
  Flag.withDescription("Seed for every random decision, so a run can be replayed"),
  Flag.withDefault(1)
)

/**
 * Delay applied to this side's writes.
 *
 * @category flags
 * @since 0.0.0
 */
export const latency = Flag.Int("latency").pipe(
  Flag.withDescription("Milliseconds to delay every byte this side writes"),
  Flag.withDefault(0)
)

/**
 * Spread around `--latency`.
 *
 * @category flags
 * @since 0.0.0
 */
export const jitter = Flag.Int("jitter").pipe(
  Flag.withDescription("Milliseconds of spread around --latency, drawn per write"),
  Flag.withDefault(0)
)

/**
 * Where a copy of the trace is written, one JSON object per line.
 *
 * @category flags
 * @since 0.0.0
 */
export const traceFile = Flag.String("trace-file").pipe(
  Flag.withDescription("Also append every traced line to this file, as JSONL"),
  Flag.optional
)

/**
 * The SQLite trace store both commands record into and the UI reads.
 *
 * @category flags
 * @since 0.0.0
 */
export const traceDb = Flag.String("trace-db").pipe(
  Flag.withDescription("SQLite file every traced event is recorded into, for the wire-trace UI"),
  Flag.withDefault(".wire-trace/traces.sqlite")
)

/**
 * The host a command binds or dials.
 *
 * @category flags
 * @since 0.0.0
 */
export const host = Flag.String("host").pipe(
  Flag.withDescription("Host to bind or connect to"),
  Flag.withDefault("127.0.0.1")
)

/**
 * The TCP port a command binds or dials.
 *
 * @category flags
 * @since 0.0.0
 */
export const port = Flag.Int("port").pipe(
  Flag.withDescription("TCP port to bind or connect to"),
  Flag.withDefault(4545)
)

/**
 * Turns the two latency flags into the decorator's options.
 *
 * @category constructors
 * @since 0.0.0
 */
export const latencyOf = (config: { readonly latency: number; readonly jitter: number }): LatencyOptions => ({
  latency: Duration.millis(config.latency),
  jitter: Duration.millis(config.jitter)
})

/**
 * Stacks the tracer and the latency decorator over one byte channel, tracing
 * into a fresh sink from the recording, so the connection gets its own number.
 *
 * @category constructors
 * @since 0.0.0
 */
export const instrument = Effect.fnUntraced(function* (
  duplex: Duplex,
  options: {
    readonly source: string
    readonly recording: RecordingService
    readonly latency: LatencyOptions
  }
) {
  const sink = yield* options.recording.nextConnection
  const traced = yield* tracedDuplex(duplex, { source: options.source, sink })

  return delayedDuplex(traced, options.latency)
})

/**
 * A `Transport` that traces and delays everything it opens, layered over the
 * transport underneath it.
 *
 * @category layers
 * @since 0.0.0
 */
export const instrumentedTransport = (options: {
  readonly source: string
  readonly latency: LatencyOptions
}): Layer.Layer<Transport, never, Transport | Recording> =>
  Layer.effect(Transport)(
    Effect.gen(function* () {
      const transport = yield* Transport
      const recording = yield* Recording

      return {
        connect: (endpoint) =>
          Effect.flatMap(transport.connect(endpoint), (duplex) => instrument(duplex, { ...options, recording }))
      }
    })
  )

/**
 * Simulated controllers on real TCP ports whose every accepted connection is
 * traced into the recording and delayed, the way `instrumentedTransport`
 * treats the connections a client opens.
 *
 * @category layers
 * @since 0.0.0
 */
export const instrumentedListener = (options: {
  readonly source: string
  readonly latency: LatencyOptions
}): Layer.Layer<SimulatorNetwork, never, Recording> =>
  Layer.unwrap(
    Effect.map(Recording, (recording) =>
      simulatorOnTcp({
        decorate: (side) =>
          Effect.map(instrument(side, { ...options, recording }), (wrapped) => ({ ...wrapped, close: side.close }))
      })
    )
  )
