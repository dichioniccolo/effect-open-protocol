/**
 * The recorded wire trace, kept in SQLite.
 *
 * Every process launch of the controller or client CLI is one run, and every
 * chunk and frame its tracer emits is one event of that run. The CLIs write,
 * the UI reads, and both open the same file through this module, so the tables
 * are defined once.
 *
 * The module speaks core `effect/unstable/sql` only. Whoever provides it picks
 * the driver, which keeps the runtime choice (Bun, for `bun:sqlite`) at the
 * edges.
 *
 * No statement is written here. A run is inserted through `RunRepository`,
 * derived from the `Run` model, and the reads no derivation expresses - a run
 * list with its event counts, a paged and filtered event page - live in
 * `queries.ts`. What is left is the service: what a trace store does, and the
 * schemas each call decodes with.
 *
 * @since 0.0.0
 */
import { Context, Effect, Layer, pipe } from "effect"
import * as A from "effect/Array"
import type * as O from "effect/Option"
import * as S from "effect/Schema"
import * as Migrator from "effect/unstable/sql/Migrator"
import { SqlClient } from "effect/unstable/sql/SqlClient"
import type { SqlError } from "effect/unstable/sql/SqlError"
import * as SqlSchema from "effect/unstable/sql/SqlSchema"
import { migrations } from "./migrations.ts"
import * as Q from "./queries.ts"
import * as RunRepository from "./RunRepository.ts"
import { EventQuery, Run, RunId, RunSummary, TracedEvent } from "./Schema.ts"

/**
 * What the trace store can do: open and close runs, write events in batches,
 * and read runs and pages of events back.
 *
 * @category services
 * @since 0.0.0
 */
export interface WireStoreService {
  /** Records the start of a run and returns its id. */
  readonly startRun: (start: typeof Run.insert.Type) => Effect.Effect<RunId, SqlError | S.SchemaError>
  /** Stamps the time a run stopped recording. */
  readonly endRun: (id: RunId, endedAt: string) => Effect.Effect<void, SqlError>
  /** Writes a batch of events in one transaction. */
  readonly insertEvents: (
    events: ReadonlyArray<typeof TracedEvent.insert.Type>
  ) => Effect.Effect<void, SqlError | S.SchemaError>
  /** Every run, newest first. */
  readonly listRuns: Effect.Effect<ReadonlyArray<RunSummary>, SqlError | S.SchemaError>
  /** One run, if it exists. */
  readonly findRun: (id: RunId) => Effect.Effect<O.Option<RunSummary>, SqlError | S.SchemaError>
  /** A page of a run's events after a cursor, oldest first. */
  readonly events: (query: EventQuery) => Effect.Effect<ReadonlyArray<TracedEvent>, SqlError | S.SchemaError>
}

/**
 * Builds the store over whatever `SqlClient` is in context, applying the
 * migrations first.
 *
 * Two processes may open a new file at once. Writable SQLite transactions
 * start with `BEGIN IMMEDIATE`, so the second migrator waits for the first and
 * then finds nothing left to apply.
 *
 * **Example** (Opening the store inside a scope you already have)
 *
 * ```ts
 * import { SqliteClient } from "@effect/sql-sqlite-bun"
 * import { Effect } from "effect"
 * import { WireStore } from "@effect-open-protocol/store"
 *
 * const runCount = Effect.gen(function* () {
 *   const store = yield* WireStore.make
 *   const runs = yield* store.listRuns
 *   return runs.length
 * }).pipe(Effect.provide(SqliteClient.layer({ filename: "traces.sqlite" })))
 * ```
 *
 * @category constructors
 * @since 0.0.0
 */
export const make = Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* Migrator.make({})({ loader: Migrator.fromRecord(migrations) })

  const runs = yield* RunRepository.RunRepository

  const listRuns = SqlSchema.findAll({
    Request: S.Void,
    Result: RunSummary,
    execute: () => Q.listRunSummaries(sql)
  })

  const findRun = SqlSchema.findOneOption({
    Request: RunId,
    Result: RunSummary,
    execute: (id) => Q.findRunSummary(sql, id)
  })

  const encodeEvents = S.encodeEffect(S.Array(TracedEvent.insert))

  const events = SqlSchema.findAll({
    Request: EventQuery,
    Result: TracedEvent,
    execute: (query) => Q.eventPage(sql, query)
  })

  return WireStore.of({
    startRun: (start) => Effect.map(runs.insert(start), (run) => run.id),
    endRun: (id, endedAt) => Effect.asVoid(Q.stampRunEnd(sql, id, endedAt)),
    insertEvents: (batch) =>
      A.match(batch, {
        onEmpty: () => Effect.void,
        onNonEmpty: (rows) =>
          pipe(
            encodeEvents(rows),
            Effect.flatMap((encoded) => Q.insertEventRows(sql, encoded)),
            sql.withTransaction,
            Effect.asVoid
          )
      }),
    listRuns: listRuns(undefined),
    findRun,
    events
  })
}).pipe(Effect.withSpan("WireStore.make"))

/**
 * The recorded wire trace as a service, built by this module's `layer` over
 * whichever `SqlClient` the caller provides.
 *
 * **Example** (Listing recorded runs)
 *
 * ```ts
 * import { SqliteClient } from "@effect/sql-sqlite-bun"
 * import { WireStore } from "@effect-open-protocol/store"
 * import { Effect, Layer } from "effect"
 *
 * const runs = Effect.gen(function* () {
 *   const store = yield* WireStore.WireStore
 *   return yield* store.listRuns
 * }).pipe(
 *   Effect.provide(WireStore.layer.pipe(Layer.provide(SqliteClient.layer({ filename: "traces.sqlite" }))))
 * )
 * ```
 *
 * @category services
 * @since 0.0.0
 */
export class WireStore extends Context.Service<WireStore, WireStoreService>()(
  "@effect-open-protocol/store/WireStore"
) {}

/**
 * Opens the store over a `SqlClient`, running its migrations first and
 * deriving the `runs` repository it builds on.
 *
 * @category layers
 * @since 0.0.0
 */
export const layer: Layer.Layer<WireStore, SqlError | Migrator.MigrationError, SqlClient> = Layer.effect(WireStore)(
  make
).pipe(Layer.provide(RunRepository.layer))
