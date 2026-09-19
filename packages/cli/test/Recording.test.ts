import { NodeServices } from "@effect/platform-node"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { describe, expect, it } from "@effect/vitest"
import { assertSome } from "@effect/vitest/utils"
import { Effect, Exit, FileSystem, Layer, Path, Ref, Scope, Stream } from "effect"
import * as A from "effect/Array"
import * as O from "effect/Option"
import { SqlClient } from "effect/unstable/sql/SqlClient"
import { EventQuery, RunId, WireStore } from "@effect-open-protocol/store"
import { type Duplex, terminator } from "effect-open-protocol"
import * as Recording from "../src/Recording.ts"
import { instrument, latencyOf } from "../src/Wire.ts"

const encoder = new TextEncoder()

const handshake = encoder.encode(`00200001001         ${terminator}`)

const reply = encoder.encode(`00200002001         ${terminator}`)

/** The flags of a run that traces into `traceDb` and nowhere else. */
const runInto = (traceDb: string): Recording.RecordingConfig => ({
  host: "127.0.0.1",
  port: 4545,
  seed: 1,
  latency: 0,
  jitter: 0,
  traceFile: O.none(),
  traceDb
})

const tempDatabase = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const directory = yield* fs.makeTempDirectoryScoped()

  return path.join(directory, "nested", "traces.sqlite")
})

/** A duplex that replies once and keeps what it was sent. */
const fixture = Effect.gen(function* () {
  const written = yield* Ref.make<ReadonlyArray<Uint8Array>>([])

  const duplex: Duplex = {
    incoming: Stream.make(reply),
    send: (bytes) => Ref.update(written, (current) => A.append(current, bytes))
  }

  return { duplex, written }
})

const readBack = (filename: string) =>
  Effect.gen(function* () {
    const store = yield* WireStore.WireStore
    const runs = yield* store.listRuns

    const events = yield* store.events(
      new EventQuery({ runId: RunId.make(1), kind: O.none(), direction: O.none(), mid: O.none() })
    )

    return { runs, events }
  }).pipe(Effect.provide(WireStore.layer.pipe(Layer.provide(SqliteClient.layer({ filename })), Layer.fresh)))

describe("Recording", () => {
  it.effect("records every traced event of a run, in order, and ends the run on close", () =>
    Effect.gen(function* () {
      const filename = yield* tempDatabase
      const scope = yield* Scope.make()
      yield* Effect.gen(function* () {
        const recording = yield* Recording.make("client", runInto(filename))
        const latency = latencyOf({ latency: 0, jitter: 0 })

        for (const _ of [1, 2]) {
          const setup = yield* fixture
          const traced = yield* instrument(setup.duplex, { source: "client", recording, latency })
          yield* traced.send(handshake)
          yield* Stream.runDrain(traced.incoming)
        }
      }).pipe(Scope.provide(scope))
      // Closing the scope is Ctrl-C: whatever is still queued must land.
      yield* Scope.close(scope, Exit.void)

      const stored = yield* readBack(filename)
      expect(A.map(stored.runs, (run) => [run.side, run.eventCount])).toEqual([["client", 8]])
      assertSome(
        O.map(
          O.flatMap(A.head(stored.runs), (run) => run.endedAt),
          () => "ended"
        ),
        "ended"
      )
      expect(
        A.map(stored.events, (event) => [event.connection, event.direction, event.kind, O.getOrNull(event.mid)])
      ).toEqual([
        [1, "send", "chunk", null],
        [1, "send", "frame", "0001"],
        [1, "recv", "chunk", null],
        [1, "recv", "frame", "0002"],
        [2, "send", "chunk", null],
        [2, "send", "frame", "0001"],
        [2, "recv", "chunk", null],
        [2, "recv", "frame", "0002"]
      ])
      expect(stored.events[1]?.raw).toBe("00200001001         \\0")
    }).pipe(Effect.provide(NodeServices.layer))
  )

  it.effect("never fails a send when the store cannot be written", () =>
    Effect.gen(function* () {
      const filename = yield* tempDatabase
      const recording = yield* Recording.make("client", runInto(filename))
      // Another process breaks the file under the recorder.
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient
        yield* sql`drop table events`
      }).pipe(Effect.provide(SqliteClient.layer({ filename })))

      const setup = yield* fixture

      const traced = yield* instrument(setup.duplex, {
        source: "client",
        recording,
        latency: latencyOf({ latency: 0, jitter: 0 })
      })

      yield* traced.send(handshake)
      expect(yield* Ref.get(setup.written)).toEqual([handshake])
    }).pipe(Effect.provide(NodeServices.layer))
  )

  it.effect("still traces when the store cannot be opened", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const directory = yield* fs.makeTempDirectoryScoped()
      // A file where the store's directory should be.
      const blocker = path.join(directory, "blocker")
      yield* fs.writeFileString(blocker, "")
      const recording = yield* Recording.make("client", runInto(path.join(blocker, "traces.sqlite")))
      const setup = yield* fixture

      const traced = yield* instrument(setup.duplex, {
        source: "client",
        recording,
        latency: latencyOf({ latency: 0, jitter: 0 })
      })

      yield* traced.send(handshake)
      expect(yield* Ref.get(setup.written)).toEqual([handshake])
    }).pipe(Effect.provide(NodeServices.layer))
  )
})
