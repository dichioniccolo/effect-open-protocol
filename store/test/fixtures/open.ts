/**
 * Opens the store on the file named by the first argument and exits, so a
 * test can race two real processes through the migrations.
 */
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { Effect, Layer } from "effect"
import * as WireStore from "../../src/WireStore.ts"

const filename = Bun.argv[2] ?? ""

await Effect.runPromise(
  Effect.gen(function* () {
    const store = yield* WireStore.WireStore
    const runs = yield* store.listRuns
    console.log(`ok ${runs.length}`)
  }).pipe(Effect.provide(WireStore.layer.pipe(Layer.provide(SqliteClient.layer({ filename })))))
)
