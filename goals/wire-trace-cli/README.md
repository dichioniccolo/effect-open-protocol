# Wire-trace CLI

## Status

Lifecycle: `active`

Source: [`ops/manifest.json`](./ops/manifest.json)

## Mission

Ship two runnable commands that make Open Protocol observable by hand. One
serves a simulated controller on a TCP port, the other connects and receives
results, and both print every raw byte chunk and reassembled frame they send and
receive, with seeded latency available on either side.

## Launch

Use this prompt for execution-capable sessions:

```text
follow the instructions in goals/wire-trace-cli/GOAL.md
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

P6 PR to mergeable. P0 through P5 are complete, including the listener rebind,
which was the designated cut and did not need taking. Next action: open the
pull request and drive it to mergeable.

## Latest Evidence

`bunx tsc --noEmit`, `bun run test` (79 tests across 13 files) and
`bun run build` green as of 2026-09-18. Both commands were smoke-tested against
each other over a real socket: 14 results generated, 14 delivered, zero
duplicates, trace files written on both sides. The outage loop has a runnable
proof in `test/integration/TcpOutage.test.ts`.

## Notes

Born from [`explorations/wire-trace-cli/`](../../explorations/wire-trace-cli/).
The shaped pitch is
[`BRIEF.md`](../../explorations/wire-trace-cli/BRIEF.md), the decomposition is
[`MAP.md`](../../explorations/wire-trace-cli/MAP.md), and every decision carries
its rejected alternatives in
[`DECISIONS.md`](../../explorations/wire-trace-cli/DECISIONS.md).

Two things to keep in view while executing.

The appetite is a small batch, one focused session. P4, the TCP listener
teardown and rebind, is the designated cut. It races `TIME_WAIT` and touches
`makeTcp`'s finalizers, which exist because Node keeps a listening server alive
until its sockets are gone. If it resists, revert to the documented no-op and
ship the rest.

Most of this composes bricks that already exist: `makeTcp`,
`makeDeviceConnection`, `TcpTransport.layer`, `Faults`, and the `demo/chaos.ts`
CLI pattern. The new code is two `Duplex` decorators, an escaping helper, two
entrypoints, and the rebind.
