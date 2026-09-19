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
 * Identity of one recorded CLI run, the row id the store assigned when the run
 * started.
 *
 * **Example** (Reading a run id from a URL segment)
 *
 * ```ts
 * import * as S from "effect/Schema"
 * import { RunId } from "@wire-trace/store"
 *
 * const fromUrl = S.decodeUnknownOption(S.FiniteFromString.pipe(S.decodeTo(RunId)))
 *
 * const id = fromUrl("12")
 * ```
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
 * Identity of one recorded event, and the cursor a reader pages from: ids only
 * grow, so "after id N" is always "everything newer than what I have".
 *
 * **Example** (Starting a reader at the beginning of a run)
 *
 * ```ts
 * import { EventId } from "@wire-trace/store"
 *
 * const fromTheStart = EventId.make(0)
 * ```
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
 * Which CLI recorded a run: the simulated controller or the library's client.
 *
 * **Example** (Checking a side read from elsewhere)
 *
 * ```ts
 * import * as S from "effect/Schema"
 * import { RunSide } from "@wire-trace/store"
 *
 * const isSide = S.is(RunSide)
 *
 * console.log(isSide("controller")) // true
 * ```
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
 * What a CLI knows about itself when it starts recording: its side and the
 * launch flags that shape the traffic it will record.
 *
 * **Example** (Describing a client launch)
 *
 * ```ts
 * import { RunStart } from "@wire-trace/store"
 *
 * const start = new RunStart({
 *   side: "client",
 *   startedAt: "2026-09-18T10:00:00.000Z",
 *   host: "127.0.0.1",
 *   port: 4545,
 *   seed: 1,
 *   latency: 40,
 *   jitter: 15
 * })
 * ```
 *
 * @category models
 * @since 0.0.0
 */
export class RunStart extends S.Class<RunStart>("RunStart")(
  {
    side: RunSide,
    startedAt: S.String,
    host: S.String,
    port: S.Int,
    seed: S.Int,
    latency: Count,
    jitter: Count
  },
  { description: "The launch settings a run is recorded with" }
) {}

/**
 * A recorded run with what a run list needs: its event count, its newest
 * event's time, and its end time once the CLI has stopped.
 *
 * **Details**
 *
 * `endedAt` stays empty for a run that is still recording, and also for one
 * whose process was killed before it could stamp an end, so a caller telling
 * them apart looks at `lastEventAt` too.
 *
 * **Example** (Finding the runs that are still open)
 *
 * ```ts
 * import * as A from "effect/Array"
 * import * as O from "effect/Option"
 * import type { Run } from "@wire-trace/store"
 *
 * const open = (runs: ReadonlyArray<Run>) => A.filter(runs, (run) => O.isNone(run.endedAt))
 * ```
 *
 * @category models
 * @since 0.0.0
 */
export class Run extends RunStart.extend<Run>("Run")(
  {
    id: RunId,
    endedAt: S.OptionFromNullOr(S.String),
    eventCount: Count,
    lastEventAt: S.OptionFromNullOr(S.String)
  },
  { description: "A recorded CLI run with its event count and activity" }
) {}

/**
 * One traced chunk or frame, ready to be written.
 *
 * The fields after `connection` are a `WireEvent` as the tracer emitted it;
 * `raw` stays escaped, so `unescapeWire` still recovers the bytes.
 *
 * **Example** (Recording a handshake frame)
 *
 * ```ts
 * import * as O from "effect/Option"
 * import { NewEvent, RunId } from "@wire-trace/store"
 *
 * const event = new NewEvent({
 *   runId: RunId.make(1),
 *   connection: 1,
 *   at: "2026-09-18T10:00:00.100Z",
 *   direction: "send",
 *   kind: "frame",
 *   bytes: 21,
 *   mid: O.some("0001"),
 *   raw: "00200001001001010000\\0"
 * })
 * ```
 *
 * @category models
 * @since 0.0.0
 */
export class NewEvent extends S.Class<NewEvent>("NewEvent")(
  {
    runId: RunId,
    connection: S.Int.check(S.isGreaterThan(0)),
    at: S.String,
    direction: WireDirection,
    kind: WireEventKind,
    bytes: Count,
    mid: S.OptionFromNullOr(S.String),
    raw: S.String
  },
  { description: "A traced wire event tagged with its run and connection" }
) {}

/**
 * A recorded event as it is read back, carrying the row id a reader uses as
 * its next cursor.
 *
 * **Example** (Taking the cursor after a page)
 *
 * ```ts
 * import * as A from "effect/Array"
 * import * as O from "effect/Option"
 * import { EventId, type StoredEvent } from "@wire-trace/store"
 *
 * const cursorAfter = (page: ReadonlyArray<StoredEvent>) =>
 *   O.getOrElse(O.map(A.last(page), (event) => event.id), () => EventId.make(0))
 * ```
 *
 * @category models
 * @since 0.0.0
 */
export class StoredEvent extends NewEvent.extend<StoredEvent>("StoredEvent")(
  {
    id: EventId
  },
  { description: "A recorded wire event with its row id" }
) {}

/**
 * Which events of a run to read: a page after a cursor, oldest first,
 * optionally narrowed to one kind, direction or MID.
 *
 * **Details**
 *
 * `after` defaults to 0, the start of the run, and `limit` to 500 events.
 *
 * **Example** (The frames a controller sent, from the start)
 *
 * ```ts
 * import * as O from "effect/Option"
 * import { EventQuery, RunId } from "@wire-trace/store"
 *
 * const query = new EventQuery({
 *   runId: RunId.make(1),
 *   kind: O.some("frame"),
 *   direction: O.some("send"),
 *   mid: O.none()
 * })
 * ```
 *
 * @category models
 * @since 0.0.0
 */
export class EventQuery extends S.Class<EventQuery>("EventQuery")(
  {
    runId: RunId,
    after: EventId.pipe(S.withConstructorDefault(Effect.succeed(EventId.make(0)))),
    limit: S.Int.check(S.isBetween({ minimum: 1, maximum: 5000 })).pipe(S.withConstructorDefault(Effect.succeed(500))),
    kind: S.OptionFromNullOr(WireEventKind),
    direction: S.OptionFromNullOr(WireDirection),
    mid: S.OptionFromNullOr(S.String)
  },
  { description: "A page of one run's events after a cursor, with optional filters" }
) {}

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
 * import { make } from "@wire-trace/store"
 *
 * const runCount = Effect.gen(function* () {
 *   const store = yield* make
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
 *   const store = yield* WireStore
 *   return yield* store.listRuns
 * }).pipe(
 *   Effect.provide(layer.pipe(Layer.provide(SqliteClient.layer({ filename: "traces.sqlite" }))))
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
