# Typed MID Definitions

## Status

Lifecycle: `completed-retained`

Source: [`ops/manifest.json`](./ops/manifest.json)

## Mission

Let anyone define an Open Protocol MID in code, with one exact Effect Schema
type per revision and a declared reply, so `request(Def.rev(n), payload)`
returns exactly the reply type. Every built-in MID moves onto the same
mechanism.

## Launch

Use this prompt for execution-capable sessions:

```text
follow the instructions in goals/typed-mid-definitions/GOAL.md
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

Closed. P0–P6 are complete; see PLAN.md §What Landed. Next: once PR 7
merges, flip [`typed-subscriptions`](../typed-subscriptions/) to `active`.

## Latest Evidence

- [PR 7](https://github.com/dichioniccolo/effect-open-protocol/pull/7):
  `CLEAN`, mergeable, zero review threads.
- Local matrix: `bun run check`, `test` (128), `lint`, `format:check`, `build`
  all green.
- Reflection: [`history/reflections/2026-09-19-claude.md`](./history/reflections/2026-09-19-claude.md).

## Notes

- Graduated 2026-09-19 from
  [`explorations/typed-mids`](../../explorations/typed-mids/), the first of two
  goals. The follow-on [`typed-subscriptions`](../typed-subscriptions/) stays
  `paused` until this one merges.
- No appetite cut was needed: revisions extend by spreading layout entries,
  and reply revisions are mapped per request revision.
