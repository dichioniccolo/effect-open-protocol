# Decisions

<!--
Stage 2. The grilling log. One entry per resolved branch-closing question,
newest last. Unresolved questions live in ops/manifest.json `openQuestions`
until they land here. Deferred questions get an entry too, marked DEFERRED
with the reason.
-->

## 2026-09-17 — plan-is-scope

**Question:** How much of the external plan (`CAPTURE.md` 2026-09-17) is up for
renegotiation?

**Answer:** None. User: "Questo è quello che voglio fare … tutto il resto va
bene così com'è." The 11-file plan is the scope, non-goals, phases and DoD.

**Rationale:** User-authored, already shaped. Align only resolves conflicts
between plan and repo reality.

## 2026-09-17 — build-tool

**Question:** tsup or equivalent for the build?

**Answer:** tsdown. tsup rejected.

**Rationale:** User instruction. tsdown (Rolldown + Oxc dts) needs Node
`^22.18 || ^24.11 || >=26` (`RESEARCH.md` → Build).

## 2026-09-17 — effect-version

**Question:** Plan names v3 packages (`@effect/platform`, `@effect/cli`,
`Context.Tag`); repo pins Effect `4.0.0-rc.115`. Which?

**Answer:** Effect v4. Mapping: `effect/unstable/socket` (+
`@effect/platform-node` `NodeSocket`/`NodeSocketServer`), `effect/unstable/cli`,
`Context.Service`, `Schema.TaggedError`, `@effect/vitest` 4.x, `TestClock`
from `effect/testing`.

**Rationale:** Recommended. Repo standards, skills, and `.repos/effect` are v4;
plan explicitly allows adapting to current APIs. Rejected v3: fights repo
tooling. Accepted cost: socket/cli under `unstable/` may shift between RCs —
pin exact version.

## 2026-09-17 — runtime

**Question:** Plan says Node + npm; repo `CLAUDE.md` says Bun.

**Answer:** Library targets Node (`@effect/platform-node` TCP). Dev workflow uses
Bun (`bun install`, `bun run test`, `bun run build`, `bun run demo`); README
also documents npm equivalents for the clean-machine DoD.

**Rationale:** Recommended. Raw TCP not found in `@effect/platform-bun`; tsdown
requires Node anyway. Rejected "Node+npm only" (ignores repo conventions) and
"Bun everywhere" (adapter risk).

## 2026-09-17 — project-home

**Question:** Build in `effect-flow` or a new `effect-open-protocol` repo?

**Answer:** Here, in `effect-flow`. Package renamed to `effect-open-protocol`.

**Rationale:** Recommended. Reuses goals/skills pipeline; no tooling copy.

## 2026-09-17 — controller-behavior — DEFERRED

**Question:** Exact MID numbers/field widths, controller behavior on missing ACK,
keep-alive timeout, replay-from-id relevance.

**Answer:** DEFERRED to plan Phase 1 (design doc + stop for user confirmation).

**Rationale:** Plan (`00`, `03`, `05`, `10`) assigns these to Phase 1 with the
user as domain authority; answering now would duplicate that gate.

## 2026-09-17 — brief-confirmed

**Question:** Does `BRIEF.md` match the picture in your head?

**Answer:** Yes, proceed to decompose.

**Rationale:** User confirmation; shape exit signal.

## 2026-09-17 — goal-granularity

**Question:** First MAP draft had 7 goals (one per plan phase, 7+8 merged), only
the first graduating now and six gated on the Phase 1 design. How many to
graduate?

**Answer:** As few as possible: one goal, `effect-open-protocol`. Plan phases
become `PLAN.md` phases; the Phase 1 design confirmation is a stop condition
inside the goal.

**Rationale:** User instruction ("Fai meno goal possibile"). Rejected: 7 goals
with gates (recommended earlier for SPEC isolation from design changes), the
design stop still protects later phases, and one packet avoids re-entering
decompose.
