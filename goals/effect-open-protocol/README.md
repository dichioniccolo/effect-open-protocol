# Effect Open Protocol

## Status

Lifecycle: `active`

Source: [`ops/manifest.json`](./ops/manifest.json)

## Mission

Rewrite, Effect v4 only, the core of the author's production Open Protocol
service: a library that keeps tightening controllers connected through network
failures and never loses or double-counts a result, proven by a fault-injecting
simulator and chaos demo.

Graduated from exploration
[`explorations/effect-open-protocol`](../../explorations/effect-open-protocol/README.md).

## Launch

```text
follow the instructions in goals/effect-open-protocol/GOAL.md
```

`GOAL.md` is the compact launcher. `SPEC.md` remains the normative contract.

## Read This First

1. [`GOAL.md`](./GOAL.md) - compact goal launcher.
2. [`SPEC.md`](./SPEC.md) - normative source of truth.
3. [`PLAN.md`](./PLAN.md) - active execution plan.
4. [`ops/manifest.json`](./ops/manifest.json) - machine-readable routing.
5. [`research/SOURCES.md`](./research/SOURCES.md) - provenance ledger.
6. [`history/`](./history/) - evidence and closeouts.

## Current Phase

P2 Connection — next action: `ConnectionState` transition table (pure), then
session lifecycle (handshake, keep-alive, single in-flight request/reply,
reconnect `Schedule`, per-attempt `Scope`) with `TestClock` tests.

## Latest Evidence

2026-09-17, P0+P1: `bunx tsc --noEmit` clean, `bun run test` 23 passed
(3 files), `bun run build` emits `dist/index.mjs` + `.d.mts` (44 exports,
loads under plain Node). Design confirmed by the user; answers folded into
`research/DESIGN.md` §10 and the SPEC decision log.

## Notes

- Controller behavior (MID fields, missing-ACK, keep-alive timeout) comes from
  the user, never guessed.
- `demo` script lands in P5 with `demo/chaos.ts`; adding it earlier would ship a
  broken script.
- Local Node is 24.10.0; tsdown asks for ^24.11. Build and import work anyway,
  `engines` records the real requirement.
- Effect `unstable/socket` and `unstable/cli` may shift between RCs: pin exact.
