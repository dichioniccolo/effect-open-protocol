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
import { WireDirection, WireEventKind } from "../../src/transport/WireTrace.ts"
import { migrations } from "./migrations.ts"

/**
 * Identity of one recorded CLI run.
 *
 * @category models
 * @since 0.0.0
 */
export const RunId = S.Int.check(S.isGreaterThan(0)).pipe(S.brand("RunId")).annotate({
  identifier: "RunId",
  description: "Row id of one recorded CLI process run"
})

/**
 * @category models
 * @since 0.0.0
 */
export type RunId = typeof RunId.Type

/**
 * Identity of one recorded event, and the cursor a reader pages from.
 *
 * @category models
 * @since 0.0.0
 */
export const EventId = S.Int.check(S.isGreaterThanOrEqualTo(0)).pipe(S.brand("EventId")).annotate({
  identifier: "EventId",
  description: "Row id of one recorded wire event; ids only grow, so the last one seen is a cursor"
})

/**
 * @category models
 * @since 0.0.0
 */
export type EventId = typeof EventId.Type

/**
 * Which CLI recorded a run.
 *
 * @category models
 * @since 0.0.0
 */
export const RunSide = S.Literals(["controller", "client"]).annotate({
  identifier: "RunSide",
  description: "Which end of the link recorded the run"
})

/**
 * @category models
 * @since 0.0.0
 */
export type RunSide = typeof RunSide.Type

const Count = S.Int.check(S.isGreaterThanOrEqualTo(0))

/**
 * What a CLI knows about itself when it starts recording.
 *
 * @category models
 * @since 0.0.0
 */
export class RunStart extends S.Class<RunStart>("RunStart")({
  side: RunSide,
  startedAt: S.String,
  host: S.String,
  port: S.Int,
  seed: S.Int,
  latency: Count,
  jitter: Count
}, { description: "The launch settings a run is recorded with" }) {}

/**
 * A recorded run, with what the UI needs to list it.
 *
 * @category models
 * @since 0.0.0
 */
export class Run extends RunStart.extend<Run>("Run")({
  id: RunId,
  endedAt: S.OptionFromNullOr(S.String),
  eventCount: Count,
  lastEventAt: S.OptionFromNullOr(S.String)
}, { description: "A recorded CLI run with its event count and activity" }) {}

/**
 * One traced chunk or frame, ready to be written.
 *
 * The fields after `connection` are a `WireEvent` as the tracer emitted it;
 * `raw` stays escaped, so `unescapeWire` still recovers the bytes.
 *
 * @category models
 * @since 0.0.0
 */
export class NewEvent extends S.Class<NewEvent>("NewEvent")({
  runId: RunId,
  connection: S.Int.check(S.isGreaterThan(0)),
  at: S.String,
  direction: WireDirection,
  kind: WireEventKind,
  bytes: Count,
  mid: S.OptionFromNullOr(S.String),
  raw: S.String
}, { description: "A traced wire event tagged with its run and connection" }) {}

/**
 * A recorded event as it is read back.
 *
 * @category models
 * @since 0.0.0
 */
export class StoredEvent extends NewEvent.extend<StoredEvent>("StoredEvent")({
  id: EventId
}, { description: "A recorded wire event with its row id" }) {}

/**
 * Which events of a run to read: those after a cursor, optionally narrowed.
 *
 * @category models
 * @since 0.0.0
 */
export class EventQuery extends S.Class<EventQuery>("EventQuery")({
  runId: RunId,
  after: EventId.pipe(S.withConstructorDefault(Effect.succeed(EventId.make(0)))),
  limit: S.Int.check(S.isBetween({ minimum: 1, maximum: 5000 })).pipe(
    S.withConstructorDefault(Effect.succeed(500))
  ),
  kind: S.OptionFromNullOr(WireEventKind),
  direction: S.OptionFromNullOr(WireDirection),
  mid: S.OptionFromNullOr(S.String)
}, { description: "A page of one run's events after a cursor, with optional filters" }) {}

/**
 * Reads and writes the recorded trace.
 *
 * @category services
 * @since 0.0.0
 */
export interface WireStoreShape {
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
      sql`select * from events where ${
        sql.and(A.getSomes([
          O.some(sql`runId = ${query.runId}`),
          O.some(sql`id > ${query.after}`),
          O.map(O.fromNullishOr(query.kind), (kind) => sql`kind = ${kind}`),
          O.map(O.fromNullishOr(query.direction), (direction) => sql`direction = ${direction}`),
          O.map(O.fromNullishOr(query.mid), (mid) => sql`mid = ${mid}`)
        ]))
      } order by id limit ${query.limit}`
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
 * The recorded wire trace.
 *
 * **Example** (Listing recorded runs)
 *
 * ```ts
 * import { SqliteClient } from "@effect/sql-sqlite-bun"
 * import { WireStore } from "@wire-trace/store"
 * import { Effect, Layer } from "effect"
 *
 * const runs = Effect.gen(function* () {
 *   const store = yield* WireStore
 *   return yield* store.listRuns
 * }).pipe(
 *   Effect.provide(WireStore.layer.pipe(Layer.provide(SqliteClient.layer({ filename: "traces.sqlite" }))))
 * )
 * ```
 *
 * @category services
 * @since 0.0.0
 */
export class WireStore extends Context.Service<WireStore, WireStoreShape>()("wire-trace/WireStore") {
  static readonly layer: Layer.Layer<WireStore, SqlError | Migrator.MigrationError, SqlClient> = Layer.effect(
    WireStore
  )(make)
}
