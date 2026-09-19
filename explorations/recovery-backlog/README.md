# Recovery falls behind and never catches up

## Status

<!-- Keep in sync with ops/manifest.json on every stage/status change. -->
Stage: `align`
Status: `active`

Source: [`ops/manifest.json`](./ops/manifest.json)

## Spark

The chaos demo with 50 devices for 300 s loses 45% of its results, before and
after the inbox fixes. Recovery stops at `recoveryLimit`, re-reads delivered
IDs, and treats a transient rejection as final.

## Next Open Question

None. Fixed in place; the double-load question was closed as not applicable
(see DECISIONS.md, double-load).

## Read This First

1. [`ops/manifest.json`](./ops/manifest.json) - machine state: stage, status, open questions.
2. [`CAPTURE.md`](./CAPTURE.md) - raw dump (stage 0).
3. [`RESEARCH.md`](./RESEARCH.md) - prior art + capability inventory (stage 1).
4. [`DECISIONS.md`](./DECISIONS.md) - grilling log (stage 2).

## Trail

- 2026-09-19: double-load closed as not applicable; open questions empty.
- 2026-09-19: the user's own solo run still lost 662; recovery was too slow on
  a bad link and never retried after giving up. Added stop-on-silence,
  keep-up retries, and claims for results already queued. Four solo runs in a
  row: 0 lost, 0 twice. Full suite 10 times in a row: green.
- 2026-09-19: the failing command passes alone (0 lost, 0 twice). Residual
  losses under double load left as the open question.
- 2026-09-19: fixed in place: nine causes (seven in recovery and dedup, plus
  a leaked subscription and a supervisor hot loop), each with a test that
  fails on the old code, plus the simulator's leaking subscription flag.
- 2026-09-19: packet opened from a failing chaos run; capture, research and
  four align decisions done in one session.
