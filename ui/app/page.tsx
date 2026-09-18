import { SqliteClient } from "@effect/sql-sqlite-bun"
import { sqliteVersion } from "@wire-trace/store"
import { Effect } from "effect"

export const dynamic = "force-dynamic"

export default async function Page() {
  const version = await Effect.runPromise(
    sqliteVersion.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" })))
  )
  return <main className="p-8 font-mono">gate ok, sqlite {version}</main>
}
