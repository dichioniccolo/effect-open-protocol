# Trace Schema Models — Sources & Provenance

- **Cluster / origin:** inherited at graduation (2026-09-20) from
  [`explorations/sql-model/research/SOURCES.md`](../../../explorations/sql-model/research/SOURCES.md),
  which is the **primary ledger** for this packet. It came from a research
  sweep over the Effect v4 reference checkout (`.repos/effect`, linked by
  `scripts/setup-effect-ref.sh`) plus the repo's own store/CLI/UI SQL surface.
- **Provenance:** every claim below is carried by
  [`explorations/sql-model/RESEARCH.md`](../../../explorations/sql-model/RESEARCH.md).

## 1. Mined source corpus

| Source | Title | Upstream (repo) | Location (`file:line`) | Theme | Disposition |
|--------|-------|-----------------|------------------------|-------|-------------|
| `model-class` | `Model.Class` + variant field helpers | Effect-TS/effect | `.repos/effect/packages/effect/src/unstable/schema/Model.ts:35-53,205-728` | Variant schemas (select/insert/update/json) | reference — consumed as a published dependency, not ported |
| `sql-model-repo` | `SqlModel.makeRepository` | Effect-TS/effect | `.repos/effect/packages/effect/src/unstable/sql/SqlModel.ts:33-225` | Derived CRUD over a model | reference — consumed as a dependency |
| `sql-model-resolvers` | `SqlModel.makeResolvers` | Effect-TS/effect | `.repos/effect/packages/effect/src/unstable/sql/SqlModel.ts:230-268` | Batched by-id reads and batched multi-row writes via `RequestResolver` | reference |

**How these inform this packet:** the model layer is used, never vendored — the
repo already depends on `effect@4.0.0-rc.115`, which ships both modules. What we
take from the source is the *contract*: which six operations `makeRepository`
derives, and which of the store's operations therefore stay raw `sql`.

## 2. Upstream repositories & licenses

| Repo | License | Port discipline | What we take |
|------|---------|-----------------|--------------|
| Effect-TS/effect (`.repos/effect`, checkout matching `effect@4.0.0-rc.115`) | MIT (per the checkout's `LICENSE`) | reference-only — consumed as a versioned dependency; no code copied | `effect/unstable/schema/Model`, `effect/unstable/sql/SqlModel` |

## 3. External research sources

- Model.ts — @effect/sql API reference (v3-era shape of the same idea):
  <https://effect-ts.github.io/effect/sql/Model.ts.html>
- @effect/sql API Reference | Effect (v3 docs index):
  <https://effect.website/docs/v3/api/sql>

Both are v3 documentation and shape-only: the v4 authority is the local source
cited in §1. The v4-specific claims (module paths, derived operation list,
dialect handling, soft delete) have no published URL and are carried by
[`explorations/sql-model/RESEARCH.md`](../../../explorations/sql-model/RESEARCH.md) § "2026-09-20 — External landscape".

## 4. In-repo capability references

| Module | Path | Disposition |
|--------|------|-------------|
| `WireStore` service + layer | `packages/store/src/WireStore.ts` | extend — query layer rewritten, service surface likely preserved |
| Trace schemas (`RunStart`/`Run`, `NewEvent`/`StoredEvent`, `EventQuery`) | `packages/store/src/Schema.ts` | extend — candidate collapse into two `Model.Class` definitions |
| Migrations | `packages/store/src/migrations.ts` | reuse unchanged — `Model` derives no DDL |
| Store barrel | `packages/store/src/index.ts` | extend — exported schema names change if the pairs collapse |
| Recording sink | `packages/cli/src/Recording.ts:19,64-70` | reuse — consumer; batch insert is the hot path |
| UI runtime | `apps/ui/lib/server.ts` | reuse — read-only consumer |
| Store tests | `packages/store/test/WireStore.test.ts`, `packages/store/test/fixtures/open.ts`, `packages/cli/test/Recording.test.ts` | extend — the regression net for the migration |

## 5. Cross-links & provenance

- **Primary ledger (this file's source):**
  [`explorations/sql-model/research/SOURCES.md`](../../../explorations/sql-model/research/SOURCES.md).
- Source exploration: [`explorations/sql-model/README.md`](../../../explorations/sql-model/README.md)
  — [`CAPTURE.md`](../../../explorations/sql-model/CAPTURE.md),
  [`RESEARCH.md`](../../../explorations/sql-model/RESEARCH.md),
  [`DECISIONS.md`](../../../explorations/sql-model/DECISIONS.md),
  [`BRIEF.md`](../../../explorations/sql-model/BRIEF.md),
  [`MAP.md`](../../../explorations/sql-model/MAP.md).
- This packet: [`../SPEC.md`](../SPEC.md), [`../PLAN.md`](../PLAN.md),
  [`../GOAL.md`](../GOAL.md), [`../ops/manifest.json`](../ops/manifest.json)
  (`provenance.exploration` → `explorations/sql-model`).
- No sibling packets: the exploration graduated this one goal and struck its
  two gated candidates on 2026-09-20 (`DECISIONS.md` Q7).
