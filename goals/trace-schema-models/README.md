# Trace Schema Models

## Status

Lifecycle: `active`

Source: [`ops/manifest.json`](./ops/manifest.json)

## Mission

Declare each trace table once as an `effect/unstable/schema/Model` model, so
`packages/store` stops hand-writing the insert/select schema pair for runs and
events, and every consumer compiles against the derived variants.

## Launch

Use this prompt for execution-capable sessions:

```text
follow the instructions in goals/trace-schema-models/GOAL.md
```

`GOAL.md` is the compact launcher. `SPEC.md` remains the normative contract.

## Read This First

1. [`GOAL.md`](./GOAL.md) - compact goal launcher.
2. [`SPEC.md`](./SPEC.md) - normative source of truth.
3. [`PLAN.md`](./PLAN.md) - active execution plan.
4. [`ops/manifest.json`](./ops/manifest.json) - machine-readable routing.
5. [`research/SOURCES.md`](./research/SOURCES.md) - provenance ledger.
6. [`history/`](./history/) - evidence and closeouts, if present.

## Provenance

Graduated 2026-09-20 from
[`explorations/sql-model`](../../explorations/sql-model/README.md). The
reasoning lives there and is not copied here:
[`RESEARCH.md`](../../explorations/sql-model/RESEARCH.md) (why `Model` is core,
not `@effect/sql`, and why `makeRepository` and `makeResolvers` are both out),
[`DECISIONS.md`](../../explorations/sql-model/DECISIONS.md) (Q1-Q6),
[`BRIEF.md`](../../explorations/sql-model/BRIEF.md),
[`MAP.md`](../../explorations/sql-model/MAP.md).

## Current Phase

P3 PR to mergeable, second pass — [PR #11](https://github.com/dichioniccolo/effect-open-protocol/pull/11)
is open and `mergeStateStatus` is `CLEAN` with no unresolved threads. Next:
P4 Close, once it merges.

## Latest Evidence

[PR #11](https://github.com/dichioniccolo/effect-open-protocol/pull/11)
(2026-09-20), `mergeStateStatus: CLEAN`, no configured status checks.

Local, 2026-09-20: `bun run check` (4/4 workspaces), `bun run lint`,
`bun run format:check`, `bun run test` (158 tests) all pass.
`rg -n "RunStart|NewEvent|StoredEvent" packages apps` returns nothing;
`git diff -- packages/store/src/migrations.ts` is empty.

## Notes

- The store was never raw-SQL-naive: every query already ran through
  `SqlSchema`. The duplication this packet set out to remove was in
  `Schema.ts`. A second pass (`DECISIONS.md` Q8) then moved the statements
  themselves out of the service — `RunRepository` derives the run insert,
  `queries.ts` holds what no derivation expresses, and `WireStore` composes
  them.
- The `Model.Class(...).extend(...)` assumption for `RunSummary` held: it
  typechecks and yields a plain `Schema.Class`, exactly what a read model
  wants.
- Two things the spec did not foresee, both resolved in-scope: `endedAt` had to
  be `Model.FieldExcept(["insert"])` so `Run.insert` keeps the old `RunStart`
  column set and the INSERT statement is unchanged; and variant schemas are
  constructed with `.make(...)`, not `.makeUnsafe(...)`.
- Appetite is one sitting. If the change starts growing a view, a `DateTime`
  migration, or a repository layer, that is scope creep — those are gated
  re-entry points in the exploration's `MAP.md`.
