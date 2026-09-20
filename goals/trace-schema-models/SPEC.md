# Trace Schema Models Spec

Graduated from [`explorations/sql-model`](../../explorations/sql-model/README.md).
The exploration's [`BRIEF.md`](../../explorations/sql-model/BRIEF.md),
[`DECISIONS.md`](../../explorations/sql-model/DECISIONS.md),
[`RESEARCH.md`](../../explorations/sql-model/RESEARCH.md) and
[`MAP.md`](../../explorations/sql-model/MAP.md) are the back-links, not copies:
read them for the reasoning behind everything below.

## Objective

`packages/store/src/Schema.ts` declares each trace table once, as an
`effect/unstable/schema/Model` model, and every consumer compiles against the
derived variants. The four hand-rolled names `RunStart`, `Run`, `NewEvent`,
`StoredEvent` are gone, replaced by `Run` (+ `RunSummary`) and `TracedEvent`;
`bun run check`, `bun run lint` and `bun run test` are green with no behavior
change anywhere.

## Non-Goals

(From the exploration's no-gos and rabbit holes.)

- No new dependency. `Model` ships inside `effect@4.0.0-rc.115` as
  `effect/unstable/schema/Model`; `@effect/sql` is neither installed nor needed.
- No `SqlModel.makeResolvers`. It emits the same multi-row insert, but
  `SqlRequest` deduplicates equal payloads, and two traced events are equal
  whenever the same bytes cross the same connection inside the same
  millisecond — the recorder would lose rows. See `DECISIONS.md` Q8.
  (`SqlModel.makeRepository` **is** used, through `RunRepository`; the original
  Q1 rejection of it was narrowed in Q8.)
- No change to the six `WireStoreService` operations: same names, same argument
  order, same error channels, `findRun` still returning `Option`.
- No compatibility aliases for the old schema names.
- No change to `packages/store/src/migrations.ts` — no DDL, no index, no view.
- No `Model.DateTime*` conversion of `startedAt` / `endedAt` / `at`; they stay
  ISO strings.
- No UI rewiring to the `json` variants.

## Source Hierarchy

1. User objective or issue that created this packet.
2. `CLAUDE.md` and required skills (`schema-first-development`,
   `effect-first-development`).
3. Governing standards (`standards/`, `.patterns/`).
4. This `SPEC.md`.
5. `PLAN.md`.
6. `GOAL.md`.
7. Supporting `research/`, `ops/`, and `history/` files.

Higher sources outrank lower sources when they conflict.

## Target Surfaces

- `packages/store/src/Schema.ts` — the models (primary change).
- `packages/store/src/WireStore.ts` — schema references in each `SqlSchema`
  call and in `WireStoreService`; the SQL text itself is unchanged.
- `packages/store/src/index.ts` — exported names.
- `packages/cli/src/Recording.ts` — imports and constructor call sites.
- `apps/ui/` — any use of the renamed schemas.
- `packages/store/test/WireStore.test.ts`,
  `packages/store/test/fixtures/open.ts`, `packages/cli/test/Recording.test.ts`
  — constructor renames only.
- JSDoc examples inside the touched modules — they are compiled.

## Constraints

(From the exploration's rabbit holes and inherited risks.)

- The target shape is fixed by `DECISIONS.md` Q3/Q4:

  ```ts
  export class Run extends Model.Class<Run>("Run")({
    // `GeneratedByDb` omits the id from `update`, which `makeRepository`
    // requires; this is the documented shape for a primary key.
    id: Model.Field({ select: RunId, update: RunId, json: RunId }),
    side: RunSide,
    startedAt: S.String,
    endedAt: Model.FieldOption(S.String),
    host: S.String,
    port: S.Int,
    seed: S.Int,
    latency: Count,
    jitter: Count
  }) {}

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

- Name mapping: `RunStart` → `Run.insert`, today's `Run` → `RunSummary`,
  `NewEvent` → `TracedEvent.insert`, `StoredEvent` → `TracedEvent`.
- `RunId`, `EventId`, `RunSide`, `EventQuery` are unchanged. A query is not a
  row.
- `Model.FieldOption` must stay behavior-preserving: on the database variants
  it is `Schema.OptionFromNullOr`, exactly today's field type.
- `runColumns` (`WireStore.ts:48-50`) stays as it is; `RunSummary` is the
  schema that names it. `insertEvents` stays one `sql.insert` inside one
  `sql.withTransaction`.
- Validate every `Model` API against `.repos/effect`, never against
  training-data priors (`CLAUDE.md`). Run `bash scripts/setup-effect-ref.sh`
  first if `.repos/effect` is missing.
- Keep every annotation (`identifier`, `description`) the current schemas
  carry, and keep JSDoc examples compiling.
- Known risk: `Model.Class(...).extend(...)` returns a plain `Schema.Class`, so
  `RunSummary` has no `insert`/`update` variants. That is intended for a read
  model — confirm it against
  `.repos/effect/packages/effect/src/unstable/schema/VariantSchema.ts:275-300`
  in the first slice, before `TracedEvent` is built on the same assumption. If
  the types do not hold, stop and report rather than inventing a third shape.

## Acceptance Criteria

- [ ] `packages/store/src/Schema.ts` exports `Run`, `RunSummary` and
      `TracedEvent` as above; `RunStart`, `NewEvent` and `StoredEvent` no
      longer exist anywhere in the repo (`rg -n "RunStart|NewEvent|StoredEvent"`
      returns nothing outside `explorations/` and `goals/`).
- [ ] `WireStoreService` keeps its six operations with unchanged semantics,
      typed as `Run.insert` in, `RunSummary` / `TracedEvent` out,
      `TracedEvent.insert[]` for the batch.
- [ ] `migrations.ts` is byte-identical to before.
- [ ] `WireStore.ts` contains no statement text and no query definition: the
      run insert goes through `RunRepository`, and every other query — statement
      and schemas together — comes from `queries.ts`.
- [ ] No `Encoded` type appears outside `queries.ts`, and no query returns
      `Statement<unknown>`.
- [ ] `RunRepositoryService` is derived from the repository, not restated.
- [ ] `bun run check` passes across every workspace.
- [ ] `bun run lint` and `bun run format:check` pass.
- [ ] `bun run test` passes with test assertions unchanged except for renamed
      constructors.
- [ ] No unrelated refactors or formatting churn.

## Verification Matrix

| Check | Command or evidence | Required result |
| --- | --- | --- |
| Types | `bun run check` | Passes |
| Lint | `bun run lint` | Passes |
| Format | `bun run format:check` | Passes |
| Tests | `bun run test` | Passes |
| Old names gone | `rg -n "RunStart\|NewEvent\|StoredEvent" packages apps` | No matches |
| Migrations untouched | `git diff -- packages/store/src/migrations.ts` | Empty |
| No SQL in the service | `rg -n "sql\`" packages/store/src/WireStore.ts` | Prose only, no statements |
| Packet launcher size | `test "$(wc -m < goals/trace-schema-models/GOAL.md)" -le 4000` | Passes |
| Manifest JSON | `jq . goals/trace-schema-models/ops/manifest.json` | Passes |
| Whitespace | `git diff --check -- goals/trace-schema-models` | Passes |

## Decision Log

Seeded from [`explorations/sql-model/DECISIONS.md`](../../explorations/sql-model/DECISIONS.md);
that file is the authority for rationale and rejected options.

| # | Decision |
| --- | --- |
| Q1 | Model variants only — queries stay on `SqlSchema` / raw `sql`; no `makeRepository`, and no `makeResolvers` (it batches on the wrong axis; see the correction in `DECISIONS.md`). |
| Q2 | Free to break exported names; every consumer is in-tree and pre-1.0. |
| Q3 | `Run` is the table row; `RunSummary` extends it with the computed columns. |
| Q4 | The event model is `TracedEvent`. |
| Q5 | `WireStore`'s six operations keep their semantics; only the schema types move. |
| Q6 | Appetite: one sitting. |
| Q8 | No statement text inside services: `RunRepository` derives the run insert, `queries.ts` holds the rest, `WireStore` composes them. `makeResolvers` stays out — it deduplicates equal payloads. |
| Q9 | `queries.ts` owns each query whole — statement plus `Request`/`Result` — behind a `make` that binds the client once. Encoded shapes stay inside it. |
| Q10 | `RunRepository` publishes `insert` only, with its type taken from the derivation. |

## Stop Conditions

- `Model.Class(...).extend(...)` does not typecheck for `RunSummary`, or loses
  something the read path needs.
- `Model.FieldOption` turns out not to be encoding-compatible with the current
  `S.OptionFromNullOr` columns.
- The change would require touching `migrations.ts` or altering SQL text.
- The implementation would exceed the named scope.
- The same blocker repeats after reasonable investigation.

## Exception Ledger

| Exception | Scope | Owner | Rationale | Removal condition |
| --- | --- | --- | --- | --- |
| None | N/A | N/A | N/A | N/A |
