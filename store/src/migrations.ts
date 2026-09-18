/**
 * The schema of the trace file, one migration per change.
 *
 * Loaded from a record rather than a directory, because a bundled Next server
 * has no migration folder on disk to scan.
 *
 * @since 0.0.0
 */
import { Effect } from "effect"
import { SqlClient } from "effect/unstable/sql/SqlClient"

const createRuns = Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`create table runs (
    id integer primary key autoincrement,
    side text not null check (side in ('controller', 'client')),
    startedAt text not null,
    endedAt text,
    host text not null,
    port integer not null,
    seed integer not null,
    latency integer not null,
    jitter integer not null
  )`
})

const createEvents = Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`create table events (
    id integer primary key autoincrement,
    runId integer not null references runs (id),
    connection integer not null,
    at text not null,
    direction text not null check (direction in ('send', 'recv')),
    kind text not null check (kind in ('chunk', 'frame')),
    bytes integer not null,
    mid text,
    raw text not null
  )`
  // Every read is "this run's events after id N", which is also the live cursor.
  yield* sql`create index events_run_id on events (runId, id)`
})

/**
 * Every migration, keyed `<id>_<name>` as `Migrator.fromRecord` expects.
 *
 * @category migrations
 * @since 0.0.0
 */
export const migrations = {
  "1_create_runs": createRuns,
  "2_create_events": createEvents
}
