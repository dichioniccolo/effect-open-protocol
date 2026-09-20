/**
 * Every statement the trace store runs, in one place.
 *
 * `WireStore` composes these into its service; it never writes SQL itself, so
 * the statement text lives here and the service reads as what it does rather
 * than how. Each function takes the client it runs on, which keeps them
 * pure descriptions: nothing here touches the database until a `SqlSchema`
 * wrapper or the store executes it.
 *
 * What `Model` can derive is not here at all - a run is inserted through
 * `SqlModel.makeRepository`. These are the statements no derivation covers:
 * a projection with correlated subselects, a paged and filtered read, a
 * one-column patch, and a multi-row insert.
 *
 * @since 0.0.0
 */
import * as A from "effect/Array"
import * as O from "effect/Option"
import type { SqlClient } from "effect/unstable/sql/SqlClient"
import type { Statement } from "effect/unstable/sql/Statement"
import type { EventQuery, RunId, TracedEvent } from "./Schema.ts"

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
 * Every run with its event count and activity, newest first.
 *
 * @category queries
 * @since 0.0.0
 */
export const listRunSummaries = (sql: SqlClient): Statement<unknown> =>
  sql`select ${sql.literal(runSummaryColumns)} from runs r order by r.id desc`

/**
 * One run with its event count and activity, by id.
 *
 * @category queries
 * @since 0.0.0
 */
export const findRunSummary = (sql: SqlClient, id: typeof RunId.Encoded): Statement<unknown> =>
  sql`select ${sql.literal(runSummaryColumns)} from runs r where r.id = ${id}`

/**
 * A page of one run's events after a cursor, oldest first, narrowed by
 * whichever filters the query carries.
 *
 * @category queries
 * @since 0.0.0
 */
export const eventPage = (sql: SqlClient, query: typeof EventQuery.Encoded): Statement<unknown> =>
  sql`select * from events where ${sql.and(
    A.getSomes([
      O.some(sql`runId = ${query.runId}`),
      O.some(sql`id > ${query.after}`),
      O.map(O.fromNullishOr(query.kind), (kind) => sql`kind = ${kind}`),
      O.map(O.fromNullishOr(query.direction), (direction) => sql`direction = ${direction}`),
      O.map(O.fromNullishOr(query.mid), (mid) => sql`mid = ${mid}`)
    ])
  )} order by id limit ${query.limit}`

/**
 * Stamps the time a run stopped recording.
 *
 * @category statements
 * @since 0.0.0
 */
export const stampRunEnd = (sql: SqlClient, id: RunId, endedAt: string): Statement<unknown> =>
  sql`update runs set endedAt = ${endedAt} where id = ${id}`

/**
 * Writes a batch of already-encoded events as one multi-row insert.
 *
 * **Details**
 *
 * One statement, not one per row: the recorder hands over whatever accumulated
 * while it was writing the last batch, and the wire must not wait for any of
 * it. `SqlModel.makeResolvers` builds the same statement, but a `SqlRequest`
 * hashes by payload and deduplicates equal requests, and two traced events are
 * equal whenever the same bytes cross the same connection inside the same
 * millisecond - their row ids are the only thing that differs, and the
 * database assigns those. Batching here rather than there keeps every event.
 *
 * @category statements
 * @since 0.0.0
 */
export const insertEventRows = (
  sql: SqlClient,
  rows: ReadonlyArray<typeof TracedEvent.insert.Encoded>
): Statement<unknown> => sql`insert into events ${sql.insert(rows)}`
