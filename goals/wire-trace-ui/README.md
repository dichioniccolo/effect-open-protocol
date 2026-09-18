# Wire-trace UI

## Status

Lifecycle: `active`

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

P0 Workspace, not started.

## Latest Evidence

None yet. The packet was graduated on 2026-09-18 and no implementation has
landed.

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
