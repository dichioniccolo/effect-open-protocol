import { SqliteClient } from "@effect/sql-sqlite-bun"
import { WireStore } from "@wire-trace/store"
import { Effect, Layer } from "effect"

export const dynamic = "force-dynamic"

export default async function Page() {
  const runs = await Effect.runPromise(
    WireStore.use((store) => store.listRuns).pipe(
      Effect.provide(WireStore.layer.pipe(Layer.provide(SqliteClient.layer({ filename: ":memory:" }))))
    )
  )
  return <main className="p-8 font-mono">{runs.length} runs</main>
}
