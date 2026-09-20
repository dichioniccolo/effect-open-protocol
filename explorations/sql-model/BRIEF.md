# Brief — Trace Schemas As Effect Models

## Problem

`packages/store/src/Schema.ts` writes by hand the split that Effect v4's
`Model.Class` derives. A run is declared twice — `RunStart` (what you insert)
and `Run extends RunStart.extend({ id, ... })` (what you read) — and so is an
event: `NewEvent`, then `StoredEvent extends NewEvent.extend({ id })`. Four
exported names for two tables, and the rule that binds them ("the same row,
minus the id the database assigns") lives only in the extend chain, where
nothing enforces it.

The cost is not decoding — `WireStore` already runs every query through
`SqlSchema`, so no row is parsed by hand (`WireStore.ts:81-114`). The cost is
vocabulary: every consumer has to know which of the two names a given call
wants (`packages/cli/src/Recording.ts:19` imports three of them), and every new
column has to be added in the right one of the two places.

`Model.GeneratedByDb` states that rule once, in the field, and generates the
insert variant from it. The same declaration also yields `update`, `json`,
`jsonCreate`, `jsonUpdate` for free — relevant the moment the UI stops reading
the store through a server-side runtime.

## Appetite

One sitting. `Schema.ts` rewritten, `WireStore.ts` types updated, call sites in
`packages/cli` and `apps/ui` fixed, JSDoc examples corrected, `bun run check`
/ `lint` / `test` green. One goal packet.

## Solution sketch

**Two models and one read model in `Schema.ts`:**

```ts
import { Model } from "effect/unstable/schema"

export class Run extends Model.Class<Run>("Run")({
  id: Model.GeneratedByDb(RunId),
  side: RunSide,
  startedAt: S.String,
  endedAt: Model.FieldOption(S.String),
  host: S.String,
  port: S.Int,
  seed: S.Int,
  latency: Count,
  jitter: Count
}) {}

// The runColumns projection: the runs row plus its two correlated subselects.
export class RunSummary extends Run.extend<RunSummary>("RunSummary")({
  eventCount: Count,
  lastEventAt: S.OptionFromNullOr(S.String)
}) {}

export class TracedEvent extends Model.Class<TracedEvent>("TracedEvent")({
  id: Model.GeneratedByDb(EventId),
  runId: RunId,
  connection: S.Int.check(S.isGreaterThan(0)),
  at: S.String,
  direction: WireDirection,
  kind: WireEventKind,
  bytes: Count,
  mid: Model.FieldOption(S.String),
  raw: S.String
}) {}
```

`RunStart` → `Run.insert`. `Run` (today's) → `RunSummary`. `NewEvent` →
`TracedEvent.insert`. `StoredEvent` → `TracedEvent`. `EventQuery`, `RunId`,
`EventId`, `RunSide` unchanged — a query is not a row.

**`WireStore.ts` keeps all six operations and their semantics**, swapping the
schema each `SqlSchema` call names: `Request: Run.insert` for the insert,
`Result: RunSummary` for `listRuns`/`findRun`, `Result: TracedEvent` for
`events`, `S.Array(TracedEvent.insert)` for the batch encode. `findRun` still
returns `Option`; `insertEvents` stays one `sql.insert` in one transaction.
`runColumns` stays as it is — `RunSummary` is the schema that names it.

**`migrations.ts` is untouched.** `Model` derives no DDL; the tables already
exist and their shape does not change.

## Rabbit holes

- **`makeRepository` / `makeResolvers`.** The repository derives six
  operations, four of which the store cannot use (no list, no paged/filtered
  read, and a row-at-a-time insert), and it flips `findById` to
  `NoSuchElementError`. `makeResolvers` does emit a batched multi-row insert,
  but it batches concurrent requests rather than a time window, which is the
  axis the recorder's queue already covers. Out of scope, decided in
  `DECISIONS.md` Q1.
- **A `runs_with_counts` view.** Tempting once `RunSummary` exists; it buys a
  cleaner model and costs a migration. Rejected in Q3, not reopened here.
- **`Model.DateTime*` fields.** `startedAt`/`endedAt`/`at` are ISO strings
  today, compared as strings by the UI. Converting them to `DateTime.Utc` is a
  separate change with its own blast radius.
- **JSON variants for the UI.** `Run.json` / `TracedEvent.json` exist for free
  once the models land, but wiring the UI to them is not this change.
- **`Run.extend` variant loss.** `Model.Class` returns a `Schema.Class`, so
  `RunSummary` has no `insert`/`update` variants. Wanted here — but confirm the
  types compile before building on it
  (`.repos/effect/packages/effect/src/unstable/schema/VariantSchema.ts:275-300`).

## No-gos

- No new dependency. `Model` ships in `effect@4.0.0-rc.115` as
  `effect/unstable/schema/Model`; `@effect/sql` is not installed and is not
  needed.
- No change to the six `WireStoreService` operations, their names, their
  order of arguments, or their error channels.
- No compatibility aliases for the old names. Break and fix, in one pass.
- No schema or index change in `migrations.ts`.
- No behavior change anywhere: same SQL text, same transaction boundaries,
  same rows in and out. The tests in `packages/store/test/` and
  `packages/cli/test/` should pass with their assertions untouched except for
  the renamed constructors.
