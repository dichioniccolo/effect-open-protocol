# Effect Open Protocol

## Status

<!-- Keep in sync with ops/manifest.json on every stage/status change. -->
Stage: `graduate`
Status: `graduated`

Source: [`ops/manifest.json`](./ops/manifest.json)

## Spark

Rewrite, Effect-only, the core of the author's production NestJS Open Protocol
service: a TypeScript library that keeps tightening controllers connected
through network failures and never loses or double-counts a result, proven by
a fault-injecting simulator and chaos demo. Tech-assessment project.

## Next Open Question

None — graduated into [`goals/effect-open-protocol`](../../goals/effect-open-protocol/README.md).
Reopen at `decompose` only if the P0 design stop reshapes scope beyond one goal.

## Read This First

1. [`ops/manifest.json`](./ops/manifest.json) - machine state: stage, status, open questions.
2. [`CAPTURE.md`](./CAPTURE.md) - raw dump + digest of the external plan (stage 0).
3. [`RESEARCH.md`](./RESEARCH.md) - prior art + capability inventory (stage 1).
4. [`DECISIONS.md`](./DECISIONS.md) - grilling log (stage 2).
5. [`BRIEF.md`](./BRIEF.md) - shaped pitch (stage 3).
6. [`MAP.md`](./MAP.md) - decomposition (stage 4).

## Trail

- 2026-09-17: shape — BRIEF confirmed by user. Decompose — MAP collapsed to a single goal on user request. Graduated `goals/effect-open-protocol` (SPEC/PLAN/GOAL, SOURCES carried); status → graduated.
- 2026-09-17: packet opened from user's 11-file plan (read, not imported);
  capture digest written; research (tsdown, Open Protocol refs, Effect v4
  brick map); align resolved plan-is-scope, tsdown, Effect v4, Node lib/Bun
  dev, build in this repo; controller-behavior deferred to plan Phase 1.
  Stopped at shape.
