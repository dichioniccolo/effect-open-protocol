# Wire-trace CLI plan

## Status

Status: `complete`

## Phases

| Phase | Status | Goal | Exit criteria |
| --- | --- | --- | --- |
| P0 Tracer | complete | Tracing `Duplex` decorator plus the escaping helper, in `src/transport/`, re-exported from `src/index.ts`. | Escaping round-trips under test; decorator forwards bytes untouched; `bunx tsc --noEmit` and `bun run test` green. |
| P1 Commands | complete | `cli/controller.ts` over `makeTcp`, `cli/client.ts` over `makeDeviceConnection` and `TcpTransport.layer`, both stacking the tracer, plus two `bun run` scripts. | The first vertical slice: both terminals print the same handshake from opposite directions, MID 0001, 0002, 0060, 0005. |
| P2 Latency | complete | Latency `Duplex` decorator, seeded, wired into both commands, plus `--trace-file` JSONL output. | Two runs with the same `--seed` produce trace files that diff clean. |
| P3 Controller knobs | complete | `--fault-rate` over the whole `FaultKind` catalogue, `--result-interval`, Enter to produce one result, Ctrl-C summaries on both commands. | A result produced while the link is down is delivered after recovery via MID 0064 and 0065, visible in the trace. |
| P4 Listener rebind | complete | `refuseConnections` stops being a no-op over TCP: tear the listener down for the outage window, drop open sessions, rebind. | The client sees a real `ECONNREFUSED` and recovers. Or the cut is taken, `makeTcp` reverts to the no-op, and the reason is recorded. |
| P5 Docs | complete | README section for both commands, JSDoc rubric pass on the two shipped modules, full verification run. | Verification matrix in `SPEC.md` green. |
| P6 PR to mergeable | complete | Open a pull request and drive it to mergeable: required checks green, review comments answered and resolved. | `mergeStateStatus` is `CLEAN`; zero unresolved review threads. |
| P7 Close | complete | Write the closeout reflection and flip packet state. | Packet status and evidence are updated; a closeout reflection exists. |

<!--
Phase ids must match ops/manifest.json `phases[]`. A packet may use its own
scheme (milestones, sub-phases, prose), but its plan must never contradict its
own manifest.
-->

## What Landed

Every phase is complete. The listener rebind (P4) was not cut: extracting
`simulator/TcpListener.ts` gave the teardown and rebind a home of its own, and
`test/integration/TcpOutage.test.ts` proves the whole loop, from a dropped
session through a refused connection to a recovered result.

Evidence: `bunx tsc --noEmit`, `bun run test` (79 tests, 13 files) and
`bun run build` all green; both commands smoke-tested against each other over a
real socket, 14 results generated and 14 delivered with zero duplicates.
Shipped as [PR #2](https://github.com/dichioniccolo/effect-open-protocol/pull/2),
`mergeStateStatus: CLEAN`, no unresolved threads. Closeout reflection:
[`history/reflections/2026-09-18-claude.md`](./history/reflections/2026-09-18-claude.md).

## Sequencing Rationale

Order follows the dependency chain, from
[`MAP.md`](../../explorations/wire-trace-cli/MAP.md). The tracer has no I/O and
no CLI, so it is provable alone. The entrypoints need the tracer to be worth
running. Latency and the controller knobs decorate entrypoints that already
work. The listener rebind changes existing simulator behaviour and goes last,
where dropping it costs nothing else.

Optional cuts if the appetite runs out, in this order: the listener rebind (P4,
the designated cut), then `--trace-file`, then the Enter trigger.

## P7 Closeout Checklist

Before marking the packet closed (and `status` → `completed-retained` / `complete`):

1. Write a closeout reflection via the `/reflect` skill (or copy
   `_template/history/reflections/_TEMPLATE.md`) to
   `history/reflections/<YYYY-MM-DD>-<agent>.md`. Critique the repo **tooling**
   (what worked, what didn't, what was frustrating, what you wished existed), the
   **implementation** (improvement opportunities), and the **goal/prompt** (would
   you revise it to be clearer/easier/more efficient?). Capture TODOs worth
   codifying. Its YAML frontmatter must follow the field domains in
   `_TEMPLATE.md`.
2. This packet has `reflectionRequired: true`: a missing or incomplete
   reflection blocks closeout.
3. Update `README.md` (status, latest evidence) and `ops/manifest.json` phase
   statuses + `initiative.status`.

## Execution Notes

- Preserve unrelated worktree changes.
- Keep `SPEC.md` normative and update it only when the contract changes.
- Keep this plan current; archive old run outputs under `history/`.
- The appetite is a small batch, one focused session. P4 is where it gets spent
  if anywhere; take the cut rather than the overrun.

## Verification Commands

```sh
bunx tsc --noEmit
bun run test
bun run build
test "$(wc -m < goals/wire-trace-cli/GOAL.md)" -le 4000
jq . goals/wire-trace-cli/ops/manifest.json
rg -n "wire-trace-cli|GOAL.md|agentLaunchers|packetAnchorDocument" goals/wire-trace-cli
git diff --check -- goals/wire-trace-cli
```
