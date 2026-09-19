# Typed Subscriptions

## Status

Lifecycle: `paused`

Source: [`ops/manifest.json`](./ops/manifest.json)

Resume condition: [`typed-mid-definitions`](../typed-mid-definitions/) merged.
Its P6 Close flips this packet to `active`.

## Mission

Typed `subscribe(Sub.rev(n))` returning a `Stream` of `{ value, ack }` that
survives reconnects, with the built-in tightening-result delivery rebuilt on it
and its guarantees unchanged.

## Launch

Use this prompt for execution-capable sessions:

```text
follow the instructions in goals/typed-subscriptions/GOAL.md
```

`GOAL.md` is the compact launcher. `SPEC.md` remains the normative contract.

## Read This First

1. [`GOAL.md`](./GOAL.md) - compact goal launcher.
2. [`SPEC.md`](./SPEC.md) - normative source of truth.
3. [`PLAN.md`](./PLAN.md) - active execution plan.
4. [`ops/manifest.json`](./ops/manifest.json) - machine-readable routing.
5. [`research/SOURCES.md`](./research/SOURCES.md) - provenance ledger.
6. [`history/`](./history/) - evidence and closeouts, if present.

## Current Phase

Paused before P0. Next action once resumed: P0 re-baseline against the merged
`typed-mid-definitions` code.

## Latest Evidence

Not started.

## Notes

- Graduated 2026-09-19 from
  [`explorations/typed-mids`](../../explorations/typed-mids/), the second of
  two goals.
- Line cites in `SPEC.md` predate the prerequisite goal; P0 refreshes them.
