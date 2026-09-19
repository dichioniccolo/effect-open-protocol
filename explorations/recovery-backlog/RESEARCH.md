# Research

<!--
Stage 1. Ground the capture in reality. Two halves: what exists outside the
repo (cited), and what exists inside it (so we compose bricks instead of
rebuilding them). Date sections; research goes stale.
-->

## External Landscape

2026-09-19. Only one external fact matters here: which MID 0004 error code a
controller sends for a 0064 it cannot answer.

- Code 15 is "Tightening ID requested not found" and code 79 is "Command
  failed", per the `ErrorCode` constants of the Go package
  [github.com/rlz-buro/mid](https://pkg.go.dev/github.com/rlz-buro/mid)
  (`TighteningIDRequestedNotFound = 15`, `CommandFailed = 79`). Used as a
  reference for the numbers only.
- The Atlas Copco Open Protocol specification defines MID 0064 "Old tightening
  result upload request" and MID 0065 "Old tightening result upload reply"
  ([R2.8.0 PDF](https://s3.amazonaws.com/co.tulip.cdn/OpenProtocolSpecification_R280.pdf)).

So only code 15 says the result is gone. Code 79, or any other code, may pass.

## In-Repo Capability Inventory

2026-09-19.

- `runRecovery` (`packages/open-protocol/src/results/ResultRecovery.ts`): one
  pass. Fetches `watermark + 1 .. newest`, `A.take(gap, limit)`, no filter on
  what was already delivered. `CommandRejected` of any code becomes `Missing`.
  Reports `skipped` but nothing acts on it.
- `GapRecovery.recoverGap` (`packages/open-protocol/src/connection/GapRecovery.ts`):
  one pass at a time per device (`recovering` flag), repeats only while
  `pending` is non-empty, up to `recoveryAttempts`, then stops.
- `Dedup` (`packages/open-protocol/src/results/Dedup.ts`): `seen` (bounded
  window of `dedupCapacity` IDs), `lastDelivered` (contiguous watermark),
  `ahead` (delivered above the watermark). No way to write off an ID the
  controller no longer holds: a truly missing ID pins the watermark forever and
  `ahead` grows. NOT FOUND: a write-off operation.
- `RequestReply` (`packages/open-protocol/src/connection/RequestReply.ts`):
  one slot, correlation by reply MID. A late 0065 settles whatever 0064 is
  waiting.
- `CommandRejected` (`packages/open-protocol/src/connection/ConnectionError.ts`)
  carries `code`, so recovery can tell 15 from 79 without new types.
- Simulator: `rejectCommand` fault sends code 79
  (`packages/open-protocol/simulator/Faults.ts`); a real "not found" is code 15
  (`simulator/ControllerBehaviour.ts`). The store never forgets a result.
- Acceptance harness: `packages/cli/src/chaos.ts` (`bun run demo`).

## Constraints Discovered

- One outstanding message at a time (Open Protocol), so recovery stays
  sequential. Faster recovery means fewer wasted requests, not parallel ones.
- `dedupCapacity` bounds `seen`: an ID evicted from the window looks new again.
  A pinned watermark plus eviction means re-fetching and re-delivering (dedup
  still catches it only while it is in the window).
