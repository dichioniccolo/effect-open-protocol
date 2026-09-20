/**
 * The reads and writes no derivation expresses, each one whole.
 *
 * A query is its statement *and* the schemas it decodes with, so both live
 * here rather than half in `WireStore`. The client is taken once, when the set
 * is built, which is also what keeps encoded row shapes inside this module:
 * `SqlSchema` hands `execute` the encoded request, and nothing outside needs to
 * know that.
 *
 * What `Model` derives is not here at all - a run is inserted through
 * `RunRepository`. What is left is a projection with correlated subselects, a
 * paged and filtered read, a one-column patch, and a multi-row insert.
 *
 * @since 0.0.0
 */
import { Effect } from "effect"
import * as A from "effect/Array"
import * as O from "effect/Option"
import * as S from "effect/Schema"
import { SqlClient } from "effect/unstable/sql/SqlClient"
import * as SqlSchema from "effect/unstable/sql/SqlSchema"
import { EventQuery, RunId, RunSummary, TracedEvent } from "./Schema.ts"

/**
 * The `runs` row plus the two values a run list needs, counted from `events`.
 *
 * Correlated subselects rather than a join and a group by: a run list is
 * short, and this keeps the shape of one row the shape of one `RunSummary`.
 */
const runSummaryColumns = `r.id, r.side, r.startedAt, r.endedAt, r.host, r.port, r.seed, r.latency, r.jitter,
  (select count(*) from events e where e.runId = r.id) as eventCount,
  (select max(e.at) from events e where e.runId = r.id) as lastEventAt`

/**
 * Builds every query over whatever `SqlClient` is in context.
 *
 * @category constructors
 * @since 0.0.0
 */
export const make = Effect.gen(function* () {
  const sql = yield* SqlClient

  const encodeEvents = S.encodeEffect(S.Array(TracedEvent.insert))

  /** Every run with its event count and activity, newest first. */
  const listRunSummaries = SqlSchema.findAll({
    Request: S.Void,
    Result: RunSummary,
    execute: () => sql`select ${sql.literal(runSummaryColumns)} from runs r order by r.id desc`
  })

  /** One run with its event count and activity, by id. */
  const findRunSummary = SqlSchema.findOneOption({
    Request: RunId,
    Result: RunSummary,
    execute: (id) => sql`select ${sql.literal(runSummaryColumns)} from runs r where r.id = ${id}`
  })

  /** A page of one run's events after a cursor, narrowed by the query's filters. */
  const eventPage = SqlSchema.findAll({
    Request: EventQuery,
    Result: TracedEvent,
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

  /** Stamps the time a run stopped recording. */
  const stampRunEnd = (id: RunId, endedAt: string) =>
    Effect.asVoid(sql`update runs set endedAt = ${endedAt} where id = ${id}`)

  /**
   * Writes a batch of events as one multi-row insert, in one transaction.
   *
   * `SqlModel.makeResolvers` builds the same statement, and is deliberately not
   * used: a `SqlRequest` hashes by payload and deduplicates equal requests, and
   * two traced events are equal whenever the same bytes cross the same
   * connection inside the same millisecond. Their row ids are the only thing
   * that differs, and the database assigns those, so the recorder would lose
   * rows.
   */
  const insertEvents = (rows: A.NonEmptyReadonlyArray<typeof TracedEvent.insert.Type>) =>
    encodeEvents(rows).pipe(
      Effect.flatMap((encoded) => sql`insert into events ${sql.insert(encoded)}`),
      sql.withTransaction,
      Effect.asVoid
    )

  return { listRunSummaries, findRunSummary, eventPage, stampRunEnd, insertEvents } as const
})

/**
 * Every query the trace store runs, already bound to its client.
 *
 * @category models
 * @since 0.0.0
 */
export interface Queries extends Effect.Success<typeof make> {}
