# <Goal Title> Plan

## Status

Status: `pending`

## Phases

| Phase | Status | Goal | Exit criteria |
| --- | --- | --- | --- |
| P0 Research | pending | Inspect source hierarchy and confirm scope. | Required facts and blockers are recorded. |
| P1 Implement | pending | Make the smallest changes that satisfy `SPEC.md`. | Acceptance criteria are met. |
| P2 Verify | pending | Run required checks and capture evidence. | Verification is green or blockers are documented. |
| P3 PR to mergeable | pending | Open a pull request and drive it to mergeable: required checks green, review comments answered and resolved. | `mergeStateStatus` is `CLEAN`; zero unresolved review threads. |
| P4 Close | pending | Write the closeout reflection and flip packet state. | Packet status and evidence are updated; a closeout reflection exists. |

<!--
Phase ids must match ops/manifest.json `phases[]`. A packet may use its own
scheme (milestones, sub-phases, prose), but its plan must never contradict its
own manifest.
-->

## P4 Closeout Checklist

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

## Verification Commands

```sh
test "$(wc -m < goals/<slug>/GOAL.md)" -le 4000
jq . goals/<slug>/ops/manifest.json
rg -n "<slug>|GOAL.md|agentLaunchers|packetAnchorDocument" goals/<slug>
git diff --check -- goals/<slug>
```
