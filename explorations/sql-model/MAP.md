# Map

## 2026-09-20

## Candidate goal packets

| Slug | Mission | Depends on | Status |
| --- | --- | --- | --- |
| `trace-schema-models` | Replace the hand-rolled insert/select schema pairs in `packages/store` with `Model.Class` models and update every consumer in one pass. | — | promised now |
| ~~*(gated)* `trace-model-json-variants`~~ | ~~Wire the UI to `Run.json` / `TracedEvent.json` instead of the select variants.~~ | — | struck 2026-09-20 |
| ~~*(gated)* `trace-datetime-fields`~~ | ~~Move `startedAt` / `endedAt` / `at` from ISO strings to `Model.DateTime*` fields.~~ | — | struck 2026-09-20 |

One goal, `trace-schema-models`. The two gated candidates were struck on
2026-09-20 at the user's request: not re-entry points, just rabbit holes the
brief already names as out of scope. This packet has no gate left to fire.

## Sequencing

One packet, no edges. Inside it, the order is forced by the compiler:

1. `packages/store/src/Schema.ts` — models first; everything downstream is a
   type error until it is done.
2. `packages/store/src/WireStore.ts` — swap the schemas each `SqlSchema` call
   names; queries and transaction boundaries unchanged.
3. `packages/store/src/index.ts` — the barrel's exported names.
4. `packages/cli/src/Recording.ts`, `apps/ui/` — call sites.
5. Tests and JSDoc examples — `packages/store/test/`, `packages/cli/test/`,
   and the compilable examples inside `Schema.ts` / `WireStore.ts`.

## First vertical slice

`Run` end to end: model + `RunSummary`, `startRun` / `endRun` / `listRuns` /
`findRun` retyped, `packages/store/test/WireStore.test.ts` green for runs.
`TracedEvent` follows the same shape once that compiles, which also settles the
`Run.extend` variant-loss risk (`DECISIONS.md` Q3) before the second model is
built on it.

## Capability check

| Component | Capability | Path |
| --- | --- | --- |
| Variant models (`Model.Class`, `GeneratedByDb`, `FieldOption`) | Existing dependency — `effect@4.0.0-rc.115` | `effect/unstable/schema/Model` (`.repos/effect/packages/effect/src/unstable/schema/Model.ts`) |
| Schema-driven queries | Existing, already in use | `effect/unstable/sql/SqlSchema`, `packages/store/src/WireStore.ts:81-114` |
| Trace schemas being replaced | Existing | `packages/store/src/Schema.ts` |
| Migrations | Existing, unchanged | `packages/store/src/migrations.ts` |
| Store consumers | Existing | `packages/cli/src/Recording.ts`, `apps/ui/lib/server.ts` |
| Test surface | Existing | `packages/store/test/WireStore.test.ts`, `packages/store/test/fixtures/open.ts`, `packages/cli/test/Recording.test.ts` |

Nothing is NET-NEW. The change composes an already-installed Effect module
against schemas and a store that both exist.

## Inherited risks

- `Model.Class(...).extend(...)` returns a plain `Schema.Class`, so
  `RunSummary` carries no variants (`DECISIONS.md` Q3). Wanted, but unproven
  against the compiler — the first slice settles it.
- The rename crosses a package boundary: `packages/store`'s barrel is imported
  by `packages/cli` and `apps/ui`. `bun run check` covers every workspace, so a
  missed call site fails the check rather than shipping.
- JSDoc examples in `Schema.ts` and `WireStore.ts` name the old classes and are
  compiled; they are part of the change, not a follow-up.
