# Effect Open Protocol Plan

## Status

Status: `in-progress`, P0 to P6 complete; next is P7 Docs

## Phases

Plan phases 1–8 from the user's plan (`10-fasi-e-definition-of-done.md`, digest
in exploration `CAPTURE.md`), followed by PR and close. Each implementation phase
lands with its tests; `bunx tsc --noEmit` + `bun run test` green before the next.

| Phase | Status | Goal | Exit criteria |
| --- | --- | --- | --- |
| P0 Design | complete | Tooling (package rename, tsdown build, `engines`, `@effect/platform-node`, scripts) + `research/DESIGN.md`: MID subset + types, state machine, correlation, delivery + dedup, public API example, numbered questions on controller behavior. | Build/test/check green on placeholder entry; **user confirms design** (stop). |
| P1 Protocol | complete | Header, framer, encoder, MID Schemas, protocol errors; `Transport` service + in-memory transport; minimal simulator (handshake, keep-alive). | Roundtrip + chunking property tests pass. |
| P2 Connection | complete | Pure state machine; handshake, keep-alive + silent death, single in-flight request/reply, reconnect Schedule, per-attempt Scope, observable state. | Plan `08` connection matrix passes under `TestClock`. |
| P3 Delivery | complete | Subscribe + restore, handler-then-ACK, bounded dedup, backpressure; simulator resends un-ACKed per confirmed behavior. | Plan `08` delivery matrix passes. |
| P4 Pool + TCP | complete | `DevicePool`, `TcpTransport`, simulator TCP server, localhost smoke test. | Isolation, add/remove, shutdown tests pass. |
| P5 Chaos | complete | Seeded faults; chaos demo CLI with summary; e2e invariant test. | Demo lost = 0; e2e zero lost / zero duplicate. |
| P6 Hardening | complete | Review errors vs defects, races (disconnect during request/ACK), interruption, logging, API ergonomics, test quality (`quality-review-fix-loop`). | Zero required findings. |
| P7 Docs | complete | README per plan `09`, ADRs, NestJS vs Effect drafted with questions and completed with user, AI usage, learnings; clean-clone DoD run. | SPEC acceptance satisfied. |
| P8 PR to mergeable | complete | Open PR, drive to mergeable. | `mergeStateStatus` `CLEAN`; zero unresolved threads. |
| P9 Close | complete | Closeout reflection, flip packet state. | Reflection exists; status updated. |

## P9 Closeout Checklist

Before marking the packet closed (`status` → `completed-retained`):

1. Write a closeout reflection via the `/reflect` skill to
   `history/reflections/<YYYY-MM-DD>-<agent>.md` (frontmatter per
   `history/reflections/_TEMPLATE.md`).
2. `reflectionRequired: true`: missing reflection blocks closeout.
3. Update `README.md` (status, latest evidence) and `ops/manifest.json` phase
   statuses + `initiative.status`.

## Execution Notes

- Preserve unrelated worktree changes.
- Keep `SPEC.md` normative; append execution decisions to its decision log.
- Verify Effect APIs in `.repos/effect` (run `bash scripts/setup-effect-ref.sh` if missing).
- Cut order if appetite runs out: replay-from-id, rarer
  faults, verbose logging mode.

## Verification Commands

```sh
bunx tsc --noEmit
bun run test
bun run build
test "$(wc -m < goals/effect-open-protocol/GOAL.md)" -le 4000
jq . goals/effect-open-protocol/ops/manifest.json
git diff --check -- goals/effect-open-protocol
```
