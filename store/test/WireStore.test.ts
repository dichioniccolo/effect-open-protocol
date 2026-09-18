import { SqliteClient } from "@effect/sql-sqlite-bun"
import { describe, expect, it } from "@effect/vitest"
import { assertNone, assertSome } from "@effect/vitest/utils"
import { NodeServices } from "@effect/platform-node"
import { Effect, FileSystem, Layer, Path } from "effect"
import * as A from "effect/Array"
import * as O from "effect/Option"
import { EventId, EventQuery, NewEvent, RunId, RunStart, WireStore } from "../src/WireStore.ts"

/** A fresh database file in a directory that disappears with the test. */
const tempDatabase = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const directory = yield* fs.makeTempDirectoryScoped()
  return path.join(directory, "traces.sqlite")
})

const storeAt = (filename: string) => WireStore.layer.pipe(Layer.provide(SqliteClient.layer({ filename })), Layer.fresh)

const start = new RunStart({
  side: "client",
  startedAt: "2026-09-18T10:00:00.000Z",
  host: "127.0.0.1",
  port: 4545,
  seed: 1,
  latency: 0,
  jitter: 0
})

const event = (runId: RunId, at: string, fields: Partial<Pick<NewEvent, "direction" | "kind" | "mid">>) =>
  new NewEvent({
    runId,
    connection: 1,
    at,
    direction: fields.direction ?? "send",
    kind: fields.kind ?? "frame",
    bytes: 21,
    mid: fields.mid ?? O.some("0001"),
    raw: "00200001001         \\0"
  })

describe("WireStore", () => {
  it.effect("records a run and reads it back", () =>
    Effect.gen(function* () {
      const filename = yield* tempDatabase
      yield* Effect.gen(function* () {
        const store = yield* WireStore
        const id = yield* store.startRun(start)
        yield* store.insertEvents([
          event(id, "2026-09-18T10:00:00.100Z", { kind: "chunk", mid: O.none() }),
          event(id, "2026-09-18T10:00:00.101Z", {}),
          event(id, "2026-09-18T10:00:00.150Z", { direction: "recv", mid: O.some("0002") })
        ])

        const all = yield* store.events(
          new EventQuery({ runId: id, kind: O.none(), direction: O.none(), mid: O.none() })
        )
        expect(A.map(all, (stored) => stored.kind)).toEqual(["chunk", "frame", "frame"])
        expect(all[0]?.mid).toEqual(O.none())
        expect(all[2]?.direction).toBe("recv")

        const frames = yield* store.events(
          new EventQuery({ runId: id, kind: O.some("frame"), direction: O.none(), mid: O.none() })
        )
        expect(frames).toHaveLength(2)

        const replies = yield* store.events(
          new EventQuery({ runId: id, kind: O.none(), direction: O.none(), mid: O.some("0002") })
        )
        expect(A.map(replies, (stored) => stored.direction)).toEqual(["recv"])

        const cursor = all[1]?.id ?? EventId.make(0)
        const after = yield* store.events(
          new EventQuery({ runId: id, after: cursor, kind: O.none(), direction: O.none(), mid: O.none() })
        )
        expect(A.map(after, (stored) => stored.id)).toEqual([all[2]?.id])

        const open = yield* store.findRun(id)
        assertSome(
          O.map(open, (run) => run.eventCount),
          3
        )
        assertSome(
          O.flatMap(open, (run) => run.lastEventAt),
          "2026-09-18T10:00:00.150Z"
        )
        assertNone(O.flatMap(open, (run) => run.endedAt))

        yield* store.endRun(id, "2026-09-18T10:05:00.000Z")
        const ended = yield* store.findRun(id)
        assertSome(
          O.flatMap(ended, (run) => run.endedAt),
          "2026-09-18T10:05:00.000Z"
        )

        assertNone(yield* store.findRun(RunId.make(id + 1)))
      }).pipe(Effect.provide(storeAt(filename)))
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  )

  it.effect("lists runs newest first and ignores an empty batch", () =>
    Effect.gen(function* () {
      const filename = yield* tempDatabase
      yield* Effect.gen(function* () {
        const store = yield* WireStore
        const first = yield* store.startRun(start)
        const second = yield* store.startRun(new RunStart({ ...start, side: "controller" }))
        yield* store.insertEvents([])
        const runs = yield* store.listRuns
        expect(A.map(runs, (run) => run.id)).toEqual([second, first])
        expect(A.map(runs, (run) => run.eventCount)).toEqual([0, 0])
      }).pipe(Effect.provide(storeAt(filename)))
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  )

  it.effect("keeps its data when the migrations run again", () =>
    Effect.gen(function* () {
      const filename = yield* tempDatabase
      const id = yield* WireStore.use((store) => store.startRun(start)).pipe(Effect.provide(storeAt(filename)))
      const runs = yield* WireStore.use((store) => store.listRuns).pipe(Effect.provide(storeAt(filename)))
      expect(A.map(runs, (run) => run.id)).toEqual([id])
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  )

  it.effect(
    "lets two processes open a new file at once",
    () =>
      Effect.gen(function* () {
        const filename = yield* tempDatabase
        const path = yield* Path.Path
        const script = path.join(import.meta.dirname, "fixtures", "open.ts")
        const open = Effect.tryPromise(async () => {
          const child = Bun.spawn([process.execPath, script, filename], { stdout: "pipe", stderr: "pipe" })
          const [code, stdout, stderr] = await Promise.all([
            child.exited,
            new Response(child.stdout).text(),
            new Response(child.stderr).text()
          ])
          return { code, stdout, stderr }
        })
        const results = yield* Effect.all([open, open, open], { concurrency: "unbounded" })
        expect(A.map(results, (result) => [result.code, result.stdout.trim(), result.stderr])).toEqual([
          [0, "ok 0", ""],
          [0, "ok 0", ""],
          [0, "ok 0", ""]
        ])
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    { timeout: 30_000 }
  )
})
