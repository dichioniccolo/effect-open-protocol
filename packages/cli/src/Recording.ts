/**
 * Where a command's trace is kept: one sink per connection, feeding the JSONL
 * file when one was asked for and the shared SQLite trace store.
 *
 * The tracer waits for its sink before the bytes go out, and `bun:sqlite` is
 * synchronous, so a database write done inline would put a locked file on the
 * wire's critical path. The database sink therefore only enqueues. A fiber
 * writes the queue out in batches, and closing the recording writes whatever
 * is still queued before stamping the run's end, so Ctrl-C keeps the last
 * events too.
 *
 * @since 0.0.0
 */
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { Context, Effect, Fiber, FileSystem, Layer, Path, pipe, Queue, Ref, type Scope } from "effect"
import * as A from "effect/Array"
import * as DateTime from "effect/DateTime"
import * as O from "effect/Option"
import { Run, type RunId, type RunSide, TracedEvent, WireStore } from "@effect-open-protocol/store"
import { type WireEvent, wireEventLine, type WireSink } from "effect-open-protocol"

/**
 * Hands out a sink for each connection a command opens or accepts, so every
 * recorded event carries the number of the connection it crossed.
 *
 * @category models
 * @since 0.0.0
 */
export interface RecordingService {
  readonly nextConnection: Effect.Effect<WireSink>
}

/** The most events written in one transaction. */
const batchSize = 500

const now = Effect.map(DateTime.now, DateTime.formatIso)

const toRow =
  (runId: RunId, connection: number) =>
  (event: WireEvent): typeof TracedEvent.insert.Type =>
    TracedEvent.insert.make({
      runId,
      connection,
      at: event.at,
      direction: event.direction,
      kind: event.kind,
      bytes: event.bytes,
      mid: event.mid,
      raw: event.raw
    })

/**
 * Opens the trace store at `filename`, records the start of this run, and
 * returns a sink factory that queues events for a background writer.
 *
 * Writes that fail are logged and dropped. Recording is an observer, and the
 * link it watches must not notice it.
 */
const openDatabase = Effect.fnUntraced(function* (filename: string, start: typeof Run.insert.Type) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  yield* fs.makeDirectory(path.dirname(filename), { recursive: true })

  const context = yield* Layer.build(WireStore.layer.pipe(Layer.provide(SqliteClient.layer({ filename }))))
  const store = Context.get(context, WireStore.WireStore)
  const runId = yield* store.startRun(start)
  const queue = yield* Queue.unbounded<typeof TracedEvent.insert.Type>()

  const write = (batch: ReadonlyArray<typeof TracedEvent.insert.Type>) =>
    Effect.catchCause(store.insertEvents(batch), (cause) =>
      Effect.logWarning("could not record wire events", cause).pipe(Effect.annotateLogs({ dropped: batch.length }))
    )

  // Taking is interruptible and writing is not, so stopping the writer never
  // strands a batch that was taken but not written.
  const writer = yield* Effect.forkChild(
    Effect.forever(
      Effect.uninterruptibleMask((restore) => Effect.flatMap(restore(Queue.takeBetween(queue, 1, batchSize)), write))
    )
  )

  yield* Effect.addFinalizer(() =>
    pipe(
      Fiber.interrupt(writer),
      Effect.andThen(Queue.clear(queue)),
      Effect.flatMap(write),
      Effect.andThen(now),
      Effect.flatMap((endedAt) => store.endRun(runId, endedAt)),
      Effect.catchCause((cause) => Effect.logWarning("could not close the recorded run", cause))
    )
  )

  yield* Effect.logInfo("recording to the trace store").pipe(Effect.annotateLogs({ traceDb: filename, runId }))

  return (connection: number): WireSink =>
    (event) =>
      Effect.asVoid(Queue.offer(queue, toRow(runId, connection)(event)))
})

/**
 * Opens the trace file, when one was asked for, and returns the sink that
 * appends to it. The file closes with the calling scope.
 */
const openTraceFile = (
  path: O.Option<string>
): Effect.Effect<O.Option<WireSink>, never, FileSystem.FileSystem | Scope.Scope> =>
  O.match(path, {
    onNone: () => Effect.succeed(O.none()),
    onSome: (target) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const file = yield* fs.open(target, { flag: "a" })
        const encoder = new TextEncoder()

        const sink: WireSink = (event: WireEvent) =>
          pipe(
            wireEventLine(event),
            Effect.flatMap((line) => file.write(encoder.encode(`${line}\n`))),
            Effect.asVoid,
            // A trace that cannot be written must never take the run with it.
            Effect.catchCause((cause) => Effect.logWarning("could not append to the trace file", cause))
          )

        return O.some(sink)
      }).pipe(Effect.orDie)
  })

/**
 * What a command run records about itself: where it traces to, and the flags
 * that make the run replayable.
 *
 * @category models
 * @since 0.0.0
 */
export interface RecordingConfig {
  readonly host: string
  readonly port: number
  readonly seed: number
  readonly latency: number
  readonly jitter: number
  /** JSONL file to append every event to, when the flags asked for one. */
  readonly traceFile: O.Option<string>
  /** The SQLite trace store both commands write into. */
  readonly traceDb: string
}

/**
 * Builds the recording for one command run: the JSONL file, if any, plus the
 * trace store at `traceDb`.
 *
 * A store that cannot be opened costs a warning and nothing else; the command
 * still runs and still logs every frame.
 *
 * @category constructors
 * @since 0.0.0
 */
export const make = Effect.fnUntraced(function* (side: RunSide, config: RecordingConfig) {
  const startedAt = yield* now
  const file = yield* openTraceFile(config.traceFile)

  const start = Run.insert.make({
    side,
    host: config.host,
    port: config.port,
    seed: config.seed,
    latency: config.latency,
    jitter: config.jitter,
    startedAt
  })

  const database = yield* pipe(
    openDatabase(config.traceDb, start),
    Effect.map(O.some),
    Effect.catchCause((cause) =>
      Effect.as(Effect.logWarning("recording disabled, could not open the trace store", cause), O.none())
    )
  )

  const connections = yield* Ref.make(0)

  const recording: RecordingService = {
    nextConnection: Effect.map(
      Ref.updateAndGet(connections, (n) => n + 1),
      (connection) => {
        const sinks = A.getSomes([file, O.map(database, (forConnection) => forConnection(connection))])

        return (event: WireEvent) => Effect.forEach(sinks, (sink) => sink(event), { discard: true })
      }
    )
  }

  return recording
})

/**
 * The trace a command is recording, for the lifetime of its layer.
 *
 * A command records one run: it provides `Recording.layer` once, and whatever
 * instruments its byte channels asks the context for the recording rather than
 * building a second one.
 *
 * **Example** (Recording a command's run)
 *
 * ```ts
 * import { Effect } from "effect"
 * import * as O from "effect/Option"
 * import * as Recording from "./Recording.ts"
 *
 * const program = Effect.gen(function* () {
 *   const recording = yield* Recording.Recording
 *   return yield* recording.nextConnection
 * }).pipe(
 *   Effect.provide(
 *     Recording.layer("client", {
 *       host: "127.0.0.1",
 *       port: 4545,
 *       seed: 1,
 *       latency: 0,
 *       jitter: 0,
 *       traceFile: O.none(),
 *       traceDb: ".effect-open-protocol/traces.sqlite"
 *     })
 *   )
 * )
 * ```
 *
 * @category services
 * @since 0.0.0
 */
export class Recording extends Context.Service<Recording, RecordingService>()("@effect-open-protocol/cli/Recording") {}

/**
 * Records one run for the lifetime of the layer, writing out whatever is still
 * queued when it closes.
 *
 * @category layers
 * @since 0.0.0
 */
export const layer = (
  side: RunSide,
  config: RecordingConfig
): Layer.Layer<Recording, never, FileSystem.FileSystem | Path.Path> => Layer.effect(Recording)(make(side, config))
