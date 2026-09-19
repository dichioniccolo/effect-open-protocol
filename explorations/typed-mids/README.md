# Typed MIDs

## Status

<!-- Keep in sync with ops/manifest.json on every stage/status change. -->
Stage: `graduate`
Status: `graduated`

Source: [`ops/manifest.json`](./ops/manifest.json)

## Spark

Define new Open Protocol MIDs on the fly, each revision typed end to end
through Effect Schema, with the reply a MID expects typed as well.

## Next Open Question

None. Graduated into
[`goals/typed-mid-definitions`](../../goals/typed-mid-definitions/) (active)
and [`goals/typed-subscriptions`](../../goals/typed-subscriptions/) (paused
until the first merges). No gated candidates remain in MAP.md. Reopen at
`decompose` only if a goal's scope turns out wrong.

## Read This First

1. [`ops/manifest.json`](./ops/manifest.json) - machine state: stage, status, open questions.
2. [`CAPTURE.md`](./CAPTURE.md) - raw dump (stage 0).
3. [`RESEARCH.md`](./RESEARCH.md) - prior art + capability inventory (stage 1, if present).
4. [`DECISIONS.md`](./DECISIONS.md) - grilling log (stage 2, if present).
5. [`BRIEF.md`](./BRIEF.md) - shaped pitch (stage 3, if present).
6. [`MAP.md`](./MAP.md) - decomposition (stage 4, if present).

## Trail

- 2026-09-19: graduated as two goals, per MAP.md; the user said "graduate"
  without collapsing them. `typed-mid-definitions` is active,
  `typed-subscriptions` is paused on it. Definition-of-ready: brief complete,
  no open questions, map names the goals, capabilities cited.
- 2026-09-19: user confirmed BRIEF.md. MAP.md drafted: two candidates
  (`typed-mid-definitions`, then `typed-subscriptions`), first slice 0064 →
  0065 end to end on the new path, capability check done (NET-NEW: definitions
  module, `UnexpectedRevision`, subscription registry). Work on branch
  `explore/typed-mids`. Stopped at graduation approval.
- 2026-09-19: user confirmed the align decisions. BRIEF.md drafted: five
  elements (Field codec, per-revision MID definitions, codec, typed
  request/subscribe, migration), 8 rabbit holes, 8 no-gos. Stopped at brief
  review.
- 2026-09-19: align in 6 rounds and 15 decisions. Code-defined open registry,
  a type per revision, caller-picked revision, replies declared on the
  definition with mapped reply revisions, field DSL producing Schemas, typed
  subscribe streams with consumer acks that survive reconnects, built-ins and
  ResultDelivery migrated, simulator answers `0004` for custom MIDs,
  `request` API broken. Stopped at user confirmation before shape.
- 2026-09-19: research done. RESEARCH.md covers OpenProtocolInterpreter (MIT,
  closest prior art: a revision per field, open registry), node-open-protocol
  (GPL, reference only), and Effect Schema/Rpc building blocks. The in-repo
  inventory found a closed MID set, revision hard-coded to 1, and untyped
  replies in `RequestReply`. research/SOURCES.md started. Stopped before align.
- 2026-09-19: packet opened; first dump filed in CAPTURE.md. Stopped at capture.
