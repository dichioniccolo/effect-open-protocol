# Typed Subscriptions Plan

## Status

Status: `completed-retained`. Shipped as PR #8; P0 re-baselined
the cites on 2026-09-19.

## Phases

| Phase | Status | Goal | Exit criteria |
| --- | --- | --- | --- |
| P0 Re-baseline | completed | Read the merged `typed-mid-definitions` code: the definition module, codec, typed `request`, and where the push path sits now. Refresh the `SPEC.md` line cites, which were taken before that goal landed. | Cites in `SPEC.md` Target Surfaces match the merged code; blockers recorded. |
| P1 Subscribe primitive | completed | Subscription definitions, the registry, and `subscribe` returning `Stream<{ value, ack }>`, proven on the example custom MID over the in-memory transport. | Typed values (`expectTypeOf`), ack sends, and stopping unsubscribes; tests green. |
| P2 Survive reconnects | completed | Re-send active subscriptions after every handshake, and keep the stream alive across reconnects. | Reconnect test: the same stream emits before and after a dropped session. |
| P3 Results on subscribe | completed | `ResultDelivery` consumes `subscribe(LastResults)`. Remove the `routeUnsolicited` `LastResult` branch and the direct ack send, keeping unsolicited 0065 behaviour. | Delivery, Chaos, GapRecovery and Shutdown suites green with assertions unchanged. |
| P4 Docs | completed | README subscribing section and §Delivery semantics update; JSDoc rubric pass on new exports. | Full verification matrix in `SPEC.md` green. |
| P5 PR to mergeable | completed | Open a pull request and drive it to mergeable: required checks green, review comments answered and resolved. | `mergeStateStatus` is `CLEAN`; zero unresolved review threads. |
| P6 Close | completed | Write the closeout reflection and flip packet state. | Packet status and evidence are updated; a closeout reflection exists. |

<!--
Phase ids must match ops/manifest.json `phases[]`. A packet may use its own
scheme (milestones, sub-phases, prose), but its plan must never contradict its
own manifest.
-->

## Sequencing Rationale

- **P0 exists** because this packet was written before its prerequisite
  landed. Line cites and module names will have drifted.
- **The primitive is proven on the custom MID first (P1, P2)**, so the
  library's most critical path moves only onto something already tested.
- **`ResultDelivery` moves last (P3)**, behind suites whose assertions must
  not change (inherited risk from `MAP.md`).

## P6 Closeout Checklist

Before marking the packet closed (and `status` → `completed-retained`):

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
- Validate Effect v4 `Stream` / `Queue` APIs against `.repos/effect`.

## Verification Commands

```sh
bun run check
bun run test
bun run lint
bun run format:check
bun run build
test "$(wc -m < goals/typed-subscriptions/GOAL.md)" -le 4000
jq . goals/typed-subscriptions/ops/manifest.json
git diff --check -- goals/typed-subscriptions
```
