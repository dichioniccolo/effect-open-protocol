# Typed Subscriptions

## Status

Lifecycle: `completed-retained`

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

Closed. Every phase is done. PR #8 is `CLEAN` with zero unresolved review threads
(no required checks are configured). The closeout reflection is
[`history/reflections/2026-09-19-claude.md`](./history/reflections/2026-09-19-claude.md).

## Latest Evidence

2026-09-19, branch `feat/typed-subscriptions`:

- `bun run check`, `bun run test` (131 tests in `open-protocol`, all green on
  three runs), `bun run lint`, `bun run format:check` and `bun run build` pass.
- The Delivery, Chaos, GapRecovery, Shutdown and ResultDelivery suites are
  unchanged (`git diff --stat` on them is empty) and pass with results now
  delivered through `subscribe(LastResults)`.
- The new tests are in `test/example/ToolStatus.test.ts`: typed values, ack on
  demand, an unacked resend, unsubscribe on stop, `AlreadySubscribed`, a
  refusal, and the same stream across a reconnect.

## Notes

- Graduated 2026-09-19 from
  [`explorations/typed-mids`](../../explorations/typed-mids/), the second of
  two goals.
- Line cites in `SPEC.md` predate the prerequisite goal; P0 refreshes them.
