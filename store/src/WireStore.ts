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
 * @since 0.0.0
 */
import { Context, Effect, Layer, pipe } from "effect"
import * as A from "effect/Array"
import * as O from "effect/Option"
import * as S from "effect/Schema"
import * as Migrator from "effect/unstable/sql/Migrator"
import { SqlClient } from "effect/unstable/sql/SqlClient"
import type { SqlError } from "effect/unstable/sql/SqlError"
import * as SqlSchema from "effect/unstable/sql/SqlSchema"
import { migrations } from "./migrations.ts"
import { EventQuery, NewEvent, Run, RunId, RunStart, StoredEvent } from "./Schema.ts"

/**
 * What the trace store can do: open and close runs, write events in batches,
 * and read runs and pages of events back.
 *
 * @category services
 * @since 0.0.0
 */
export interface WireStoreService {
  /** Records the start of a run and returns its id. */
  readonly startRun: (start: RunStart) => Effect.Effect<RunId, SqlError | S.SchemaError>
  /** Stamps the time a run stopped recording. */
  readonly endRun: (id: RunId, endedAt: string) => Effect.Effect<void, SqlError>
  /** Writes a batch of events in one transaction. */
  readonly insertEvents: (events: ReadonlyArray<NewEvent>) => Effect.Effect<void, SqlError | S.SchemaError>
  /** Every run, newest first. */
  readonly listRuns: Effect.Effect<ReadonlyArray<Run>, SqlError | S.SchemaError>
  /** One run, if it exists. */
  readonly findRun: (id: RunId) => Effect.Effect<O.Option<Run>, SqlError | S.SchemaError>
  /** A page of a run's events after a cursor, oldest first. */
  readonly events: (query: EventQuery) => Effect.Effect<ReadonlyArray<StoredEvent>, SqlError | S.SchemaError>
}

const runColumns = `r.id, r.side, r.startedAt, r.endedAt, r.host, r.port, r.seed, r.latency, r.jitter,
  (select count(*) from events e where e.runId = r.id) as eventCount,
  (select max(e.at) from events e where e.runId = r.id) as lastEventAt`

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
 * import { WireStore } from "@wire-trace/store"
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

  const insertRun = SqlSchema.findOne({
    Request: RunStart,
    Result: S.Struct({ id: RunId }),
    execute: (start) => sql`insert into runs ${sql.insert(start)} returning id`
  })

  const listRuns = SqlSchema.findAll({
    Request: S.Void,
    Result: Run,
    execute: () => sql`select ${sql.literal(runColumns)} from runs r order by r.id desc`
  })

  const findRun = SqlSchema.findOneOption({
    Request: RunId,
    Result: Run,
    execute: (id) => sql`select ${sql.literal(runColumns)} from runs r where r.id = ${id}`
  })

  const encodeEvents = S.encodeEffect(S.Array(NewEvent))

  const events = SqlSchema.findAll({
    Request: EventQuery,
    Result: StoredEvent,
    execute: (query) =>
      sql`select * from events where ${sql.and(
        A.getSomes([
          O.some(sql`runId = ${query.runId}`),
          O.some(sql`id > ${query.after}`),
          O.map(O.fromNullishOr(query.kind), (kind) => sql`kind = ${kind}`),
          O.map(O.fromNullishOr(query.direction), (direction) => sql`direction = ${direction}`),
          O.map(O.fromNullishOr(query.mid), (mid) => sql`mid = ${mid}`)
        ])
      )} order by id limit ${query.limit}`
  })

  return WireStore.of({
    startRun: (start) =>
      insertRun(start).pipe(
        Effect.map((row) => row.id),
        // `insert ... returning` always yields the row it inserted.
        Effect.catchTag("NoSuchElementError", Effect.die)
      ),
    endRun: (id, endedAt) => Effect.asVoid(sql`update runs set endedAt = ${endedAt} where id = ${id}`),
    insertEvents: (batch) =>
      A.match(batch, {
        onEmpty: () => Effect.void,
        onNonEmpty: (rows) =>
          pipe(
            encodeEvents(rows),
            Effect.flatMap((encoded) => sql`insert into events ${sql.insert(encoded)}`),
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
 * import { WireStore } from "@wire-trace/store"
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
export class WireStore extends Context.Service<WireStore, WireStoreService>()("wire-trace/WireStore") {}

/**
 * Opens the store over a `SqlClient`, running its migrations first.
 *
 * @category layers
 * @since 0.0.0
 */
export const layer: Layer.Layer<WireStore, SqlError | Migrator.MigrationError, SqlClient> =
  Layer.effect(WireStore)(make)
