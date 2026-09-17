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

P4 Pool + TCP, next action: `DevicePool` over `FiberMap` (per-device
supervision, runtime add/remove, failure isolation, aggregate state), the
`TcpTransport` on `@effect/platform-node`, and a localhost smoke test.

## Latest Evidence

2026-09-17, P0–P3: `bunx tsc --noEmit` clean, `bun run test` 49 passed
(7 files), `bun run build` green. Delivery is proven end to end over a
connection, gap recovery included: results produced while the link was down
come back through MID 0064/0065 with no duplicates reaching the handler.

## Notes

- Controller behavior (MID fields, missing-ACK, keep-alive timeout) comes from
  the user, never guessed.
- `demo` script lands in P5 with `demo/chaos.ts`; adding it earlier would ship a
  broken script.
- Local Node is 24.10.0; tsdown asks for ^24.11. Build and import work anyway,
  `engines` records the real requirement.
- Effect `unstable/socket` and `unstable/cli` may shift between RCs: pin exact.
