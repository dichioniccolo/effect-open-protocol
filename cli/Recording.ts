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
import { Context, Effect, Fiber, FileSystem, Layer, Path, pipe, Queue, Ref } from "effect"
import * as A from "effect/Array"
import * as DateTime from "effect/DateTime"
import * as O from "effect/Option"
import { NewEvent, type RunId, RunStart, WireStore } from "../store/src/WireStore.ts"
import type { WireEvent, WireSink } from "../src/transport/WireTrace.ts"

/**
 * Hands out a sink for each connection a command opens or accepts, so every
 * recorded event carries the number of the connection it crossed.
 *
 * @category models
 * @since 0.0.0
 */
export interface Recording {
  readonly nextConnection: Effect.Effect<WireSink>
}

/** The most events written in one transaction. */
const batchSize = 500

const now = Effect.map(DateTime.now, DateTime.formatIso)

const toRow = (runId: RunId, connection: number) => (event: WireEvent): NewEvent =>
  new NewEvent({
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
const openDatabase = Effect.fnUntraced(function* (filename: string, start: RunStart) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  yield* fs.makeDirectory(path.dirname(filename), { recursive: true })

  const context = yield* Layer.build(
    WireStore.layer.pipe(Layer.provide(SqliteClient.layer({ filename })))
  )
  const store = Context.get(context, WireStore)
  const runId = yield* store.startRun(start)
  const queue = yield* Queue.unbounded<NewEvent>()

  const write = (batch: ReadonlyArray<NewEvent>) =>
    Effect.catchCause(store.insertEvents(batch), (cause) =>
      Effect.logWarning("could not record wire events", cause).pipe(
        Effect.annotateLogs({ dropped: batch.length })
      ))

  // Taking is interruptible and writing is not, so stopping the writer never
  // strands a batch that was taken but not written.
  const writer = yield* Effect.forkChild(
    Effect.forever(
      Effect.uninterruptibleMask((restore) =>
        Effect.flatMap(restore(Queue.takeBetween(queue, 1, batchSize)), write)
      )
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

  yield* Effect.logInfo("recording to the trace store").pipe(
    Effect.annotateLogs({ traceDb: filename, runId })
  )

  return (connection: number): WireSink => (event) =>
    Effect.asVoid(Queue.offer(queue, toRow(runId, connection)(event)))
})

/**
 * Builds the recording for one command run: the JSONL sink, if any, plus the
 * trace store at `traceDb`.
 *
 * A store that cannot be opened costs a warning and nothing else; the command
 * still runs and still logs every frame.
 *
 * @category constructors
 * @since 0.0.0
 */
export const makeRecording = Effect.fnUntraced(function* (options: {
  readonly traceDb: string
  readonly file: O.Option<WireSink>
  readonly start: Omit<RunStart, "startedAt">
}) {
  const startedAt = yield* now
  const database = yield* pipe(
    openDatabase(options.traceDb, new RunStart({ ...options.start, startedAt })),
    Effect.map(O.some),
    Effect.catchCause((cause) =>
      Effect.as(Effect.logWarning("recording disabled, could not open the trace store", cause), O.none())
    )
  )
  const connections = yield* Ref.make(0)

  const recording: Recording = {
    nextConnection: Effect.map(Ref.updateAndGet(connections, (n) => n + 1), (connection) => {
      const sinks = A.getSomes([options.file, O.map(database, (forConnection) => forConnection(connection))])
      return (event: WireEvent) => Effect.forEach(sinks, (sink) => sink(event), { discard: true })
    })
  }
  return recording
})
