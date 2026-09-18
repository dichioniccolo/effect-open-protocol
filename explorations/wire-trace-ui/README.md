# Wire-trace UI: packet viewer with SQLite history

## Status

<!-- Keep in sync with ops/manifest.json on every stage/status change. -->
Stage: `graduate`
Status: `graduated`

Source: [`ops/manifest.json`](./ops/manifest.json)

## Spark

The wire-trace commands print every packet the controller and client exchange,
but the log scrolls away and dies with the terminal. A UI that shows the
exchange, backed by SQLite so it survives between sessions, would make the
traffic browsable after the fact.

## Next Open Question

None. The packet graduated into [`goals/wire-trace-ui/`](../../goals/wire-trace-ui/),
which now carries the work. This packet stays as provenance; it reopens at
`decompose` if the DEFERRED pruning question comes due.

## Read This First

1. [`ops/manifest.json`](./ops/manifest.json) - machine state: stage, status, open questions.
2. [`CAPTURE.md`](./CAPTURE.md) - raw dump (stage 0).
3. [`RESEARCH.md`](./RESEARCH.md) - prior art + capability inventory (stage 1, if present).
4. [`DECISIONS.md`](./DECISIONS.md) - grilling log (stage 2, if present).
5. [`BRIEF.md`](./BRIEF.md) - shaped pitch (stage 3, if present).
6. [`MAP.md`](./MAP.md) - decomposition (stage 4, if present).

## Trail

- 2026-09-18: graduated. `goals/wire-trace-ui/` scaffolded from
  `goals/_template`, `SPEC.md` seeded from the brief with no-gos as non-goals
  and rabbit holes as constraints, nine phases in `PLAN.md` with P1 as the
  Next-on-Bun gate, provenance ledger carried into the goal. Status flipped to
  `graduated`.
- 2026-09-18: brief approved. `MAP.md` written: one goal packet, seven
  phases, the Next-on-Bun gate as phase 2 with a chosen fallback, first
  vertical slice at phase 4. The capability check replaced three would-be
  NET-NEW pieces with existing bricks: `Sse` encoding, `Queue.takeBetween`,
  `Migrator.fromRecord`. Awaiting approval to graduate.
- 2026-09-18: align done in three rounds, ten decisions, frontier empty,
  every answer the recommended one. Pruning is DEFERRED. `BRIEF.md` drafted:
  small batch, three pieces over one SQLite file, seven rabbit holes with the
  Next-on-Bun bundler spike as the designated cut, eight no-gos. Awaiting
  review.
- 2026-09-18: research done. `RESEARCH.md` covers vendor viewers, Next.js on
  Bun and the `bun:sqlite` bundler error, SSE, and effect-atom hydration, plus
  an inventory built on `WireSink` and six NOT FOUND gaps (no session
  identity, no SQL, no frontend, no workspaces). Key constraints: `Reactivity`
  is process-local, and the sink sits on the send hot path. Ledger in
  `research/SOURCES.md`. Advanced to align with a nine-question frontier.
- 2026-09-18: dumps filed: Next.js + Tailwind + effect atoms, Effect SQLite package; `CLAUDE.md` Frontend section rewritten. Held at capture.
- 2026-09-18: packet opened, first dump filed in `CAPTURE.md`, held at capture.
