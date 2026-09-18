# Wire-trace UI

## Status

Lifecycle: `completed-retained`

Source: [`ops/manifest.json`](./ops/manifest.json)

## Mission

Keep every wire event the controller and client CLIs trace in a shared SQLite
file, and ship a Next.js UI (Bun, Tailwind, Effect atoms) that lists runs,
pages and filters their packets, shows the raw string with its decoded header,
and tails a run live while it is still going.

## Launch

Use this prompt for execution-capable sessions:

```text
follow the instructions in goals/wire-trace-ui/GOAL.md
```

`GOAL.md` is the compact launcher. `SPEC.md` remains the normative contract.

## Read This First

1. [`GOAL.md`](./GOAL.md) - compact goal launcher.
2. [`SPEC.md`](./SPEC.md) - normative source of truth.
3. [`PLAN.md`](./PLAN.md) - active execution plan.
4. [`ops/manifest.json`](./ops/manifest.json) - machine-readable routing.
5. [`research/SOURCES.md`](./research/SOURCES.md) - provenance ledger, inherited from the exploration.
6. [`history/`](./history/) - evidence and closeouts, if present.

## Current Phase

Complete. Every phase landed; the P1 gate passed, so the fallback topology was
not needed.

## Latest Evidence

As of 2026-09-18: `bunx tsc --noEmit`, `bun run test` (89 tests across 16
files, up from 82 across 14), `bun run build`, and `tsc` plus `next build` in
`ui/` all green.

End-to-end runs against real sockets: both CLIs recorded to one file while the
UI was open. Recorded events matched the logged frames exactly (591 frames and
1182 events for the client, 592 and 1184 for the controller), both runs were
stamped ended on Ctrl-C, and the run page grew from 828 to 856 events without a
reload. After a 20 s reconnect the browser held 1100 events against 1104 in the
file, the gap being the poll interval. Filters and the detail pane were driven
in headless Chromium with no console errors.

Two findings changed the contract and are recorded in `SPEC.md` Decisions:
Next on Bun never reports a browser disconnect, so each SSE connection lives
20 s; and the first page is handed over as encoded JSON rather than through
`HydrationBoundary`.

Shipped as [PR #3](https://github.com/dichioniccolo/effect-open-protocol/pull/3),
`mergeStateStatus: CLEAN` with no review threads. Closeout reflection:
[`history/reflections/2026-09-18-claude.md`](./history/reflections/2026-09-18-claude.md).

## Notes

Born from [`explorations/wire-trace-ui/`](../../explorations/wire-trace-ui/).
The shaped pitch is
[`BRIEF.md`](../../explorations/wire-trace-ui/BRIEF.md), the decomposition is
[`MAP.md`](../../explorations/wire-trace-ui/MAP.md), and every decision carries
its rejected alternatives in
[`DECISIONS.md`](../../explorations/wire-trace-ui/DECISIONS.md).

Two things to keep in view while executing.

P1 is a gate. Next.js has to run on Bun and read SQLite through
`@effect/sql-sqlite-bun`, and `bun:sqlite` is known to break Next's bundler
unless kept external. If the gate fails, switch to the fallback already
chosen, a Bun process serving an Effect `HttpApi` and the SSE feed with Next as
a pure frontend on `AtomHttpApi`, and carry on. Do not spend days on the
bundler.

The sink sits on the wire's hot path: `tracedDuplex` awaits it before
`duplex.send`. It must only enqueue. A background fiber does the writing.
