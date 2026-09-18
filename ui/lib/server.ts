/**
 * The server's handle on the trace store.
 *
 * The UI opens the same SQLite file the CLIs record into, through the same
 * `WireStore`, so it runs the migrations too and can start before any run has
 * been recorded. `WIRE_TRACE_DB` points it elsewhere; the default is the file
 * the CLIs write when run from the repo root, seen from `ui/`.
 */
import { BunServices } from "@effect/platform-bun"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { WireStore } from "@wire-trace/store"
import { Config, Effect, FileSystem, Layer, ManagedRuntime, Path } from "effect"

const traceDb = Config.String("WIRE_TRACE_DB").pipe(Config.withDefault("../.wire-trace/traces.sqlite"))

const StoreLive = Layer.unwrap(
  Effect.gen(function* () {
    const filename = yield* traceDb
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    yield* fs.makeDirectory(path.dirname(filename), { recursive: true })
    return WireStore.layer.pipe(Layer.provide(SqliteClient.layer({ filename })))
  })
).pipe(Layer.provide(BunServices.layer))

/**
 * One runtime per server process. Next re-evaluates modules on every edit in
 * development, so the runtime is kept on `globalThis`, or each reload would
 * open another connection to the file.
 */
const holder = globalThis as typeof globalThis & {
  wireTraceRuntime?: ManagedRuntime.ManagedRuntime<WireStore, unknown>
}

export const runtime: ManagedRuntime.ManagedRuntime<WireStore, unknown> = (holder.wireTraceRuntime ??=
  ManagedRuntime.make(StoreLive))
