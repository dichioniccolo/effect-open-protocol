# Effect SQL Model Instead Of Raw SQL

## Status

<!-- Keep in sync with ops/manifest.json on every stage/status change. -->
Stage: `graduate`
Status: `graduated`

Source: [`ops/manifest.json`](./ops/manifest.json)

## Spark

Use Effect's `Model` instead of raw SQL in the trace store. Research redrew the
target: the queries are already schema-driven, and what `Model` actually
replaces is the hand-rolled insert/select schema pair in `Schema.ts`.

## Next Open Question

None — graduated into [`goals/trace-schema-models`](../../goals/trace-schema-models/README.md),
the packet's one and only goal. The two gated candidates were struck from
[`MAP.md`](./MAP.md) on 2026-09-20; nothing here reopens.

## Read This First

1. [`ops/manifest.json`](./ops/manifest.json) - machine state: stage, status, open questions.
2. [`CAPTURE.md`](./CAPTURE.md) - raw dump (stage 0).
3. [`RESEARCH.md`](./RESEARCH.md) - prior art + capability inventory (stage 1, if present).
4. [`DECISIONS.md`](./DECISIONS.md) - grilling log (stage 2, if present).
5. [`BRIEF.md`](./BRIEF.md) - shaped pitch (stage 3, if present).
6. [`MAP.md`](./MAP.md) - decomposition (stage 4, if present).

## Trail

- 2026-09-20: struck the two gated MAP candidates at the user's request; one
  goal, no re-entry points.
- 2026-09-20: brief confirmed, MAP written, graduated
  `goals/trace-schema-models`; packet closed as provenance.
- 2026-09-20: research (Model lives in effect core, not @effect/sql; store
  already schema-driven), align (6 questions closed), brief drafted; awaiting
  brief confirmation.
- 2026-09-20: packet opened; capture intake started.
