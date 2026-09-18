/**
 * Storage for recorded wire traces.
 *
 * @since 0.0.0
 */
import { Effect } from "effect"
import { SqlClient } from "effect/unstable/sql/SqlClient"

/**
 * Gate probe: the SQLite version the connected driver reports.
 *
 * @since 0.0.0
 */
export const sqliteVersion = Effect.gen(function* () {
  const sql = yield* SqlClient
  const rows = yield* sql<{ readonly version: string }>`select sqlite_version() as version`
  return rows[0]?.version ?? "unknown"
})
