# Trace Schema Models Plan

## Status

Status: `complete`

## Phases

| Phase | Status | Goal | Exit criteria |
| --- | --- | --- | --- |
| P0 Research | complete | Confirm `Model.Class`, `GeneratedByDb`, `FieldOption` and `Class.extend` against `.repos/effect`. | The three class shapes in `SPEC.md` are confirmed to typecheck, or a stop condition is raised. |
| P1 Implement | complete | `Run` + `RunSummary` first, then `TracedEvent`, barrel, call sites, tests, JSDoc examples. | `SPEC.md` acceptance criteria are met. |
| P2 Verify | complete | `bun run check`, `lint`, `format:check`, `test`; confirm the old names are gone and `migrations.ts` is untouched. | Verification matrix is green or blockers are documented. |
| P3 PR to mergeable | complete | Open a pull request and drive it to mergeable: required checks green, review comments answered and resolved. | `mergeStateStatus` is `CLEAN`; zero unresolved review threads. |
| P4 Close | complete | Write the closeout reflection and flip packet state. | Packet status and evidence are updated; a closeout reflection exists. |

<!--
Phase ids must match ops/manifest.json `phases[]`.
-->

## Sequencing

Forced by the compiler (from the exploration's
[`MAP.md`](../../explorations/sql-model/MAP.md)):

1. `packages/store/src/Schema.ts` — models first.
2. `packages/store/src/WireStore.ts` — swap the schema each `SqlSchema` call
   names; SQL text and transaction boundaries unchanged.
3. `packages/store/src/index.ts` — exported names.
4. `packages/cli/src/Recording.ts`, `apps/ui/` — call sites.
5. Tests and the compiled JSDoc examples.

**First vertical slice:** `Run` end to end — model + `RunSummary`, `startRun` /
`endRun` / `listRuns` / `findRun` retyped, `WireStore.test.ts` green for runs.
This settles the `Run.extend` variant-loss risk before `TracedEvent` relies on
the same assumption.

## Current Blockers

None. Closed 2026-09-20: PR #11 merged by rebase, reflection written, packet
flipped to `completed-retained`.

### Notes from execution (2026-09-20)

- `Run.extend` typechecks and returns a plain `Schema.Class`; the risk logged
  in `SPEC.md` is closed.
- `endedAt` is `Model.FieldOption(Model.FieldExcept(["insert"])(S.String))`:
  without the exclusion, `Run.insert` would carry `endedAt` and the INSERT
  statement would gain a column that `RunStart` never wrote.
- Variant schemas construct with `.make(...)`; `.makeUnsafe(...)` does not
  exist on `Schema.Struct`.

### Second pass (2026-09-20), `DECISIONS.md` Q8

- `WireStore.ts` holds no statement text. `RunRepository` (its own service,
  `SqlModel.makeRepository` over `Run`) does the run insert; `queries.ts` holds
  the projection, the event page, the end stamp and the batch insert.
- `Run.id` moved from `Model.GeneratedByDb` to
  `Model.Field({ select, update, json })`: `makeRepository` needs the id in the
  update variant. `Run.insert` is unchanged.
- `makeResolvers` stays rejected — `SqlRequest` deduplicates equal payloads and
  two traced events can be equal, so the recorder would lose rows.

### Third pass (2026-09-20), `DECISIONS.md` Q9-Q10

A quality review found the second pass had split each query across two files
and leaked encoded types into `queries.ts` signatures. `queries.ts` now owns
each query whole behind a `make` that binds the client once; `WireStore.make`
is 11 lines of assembly; `RunRepositoryService` is derived from the
repository and narrowed to `insert`.

## P4 Closeout Checklist

Before marking the packet closed (and `status` → `completed-retained` / `complete`):

1. Write a closeout reflection via the `/reflect` skill (or copy
   `_template/history/reflections/_TEMPLATE.md`) to
   `history/reflections/<YYYY-MM-DD>-<agent>.md`. Critique the repo **tooling**
   (what worked, what didn't, what was frustrating, what you wished existed), the
   **implementation** (improvement opportunities), and the **goal/prompt** (would
   you revise it to be clearer/easier/more efficient?). Capture TODOs worth
   codifying. Its YAML frontmatter must follow the field domains in
   `_TEMPLATE.md`.
2. This packet has `reflectionRequired: true`: a missing or incomplete
   reflection blocks closeout.
3. Update `README.md` (status, latest evidence) and `ops/manifest.json` phase
   statuses + `initiative.status`.

## Execution Notes

- Preserve unrelated worktree changes.
- Keep `SPEC.md` normative and update it only when the contract changes.
- Keep this plan current; archive old run outputs under `history/`.
- Validate every Effect v4 API against `.repos/effect`, not from memory.

## Verification Commands

```sh
bun run check
bun run lint
bun run format:check
bun run test
rg -n "RunStart|NewEvent|StoredEvent" packages apps
git diff -- packages/store/src/migrations.ts
test "$(wc -m < goals/trace-schema-models/GOAL.md)" -le 4000
jq . goals/trace-schema-models/ops/manifest.json
rg -n "trace-schema-models|GOAL.md|agentLaunchers|packetAnchorDocument" goals/trace-schema-models
git diff --check -- goals/trace-schema-models
```
