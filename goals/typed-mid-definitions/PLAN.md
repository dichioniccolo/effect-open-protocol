# Typed MID Definitions Plan

## Status

Status: `complete`

## Phases

| Phase | Status | Goal | Exit criteria |
| --- | --- | --- | --- |
| P0 Field codec | complete | Public `Field.*` module: fixed-width fields as Schemas, with and without parameter IDs, filler fields, and enum digits, over `Ascii.ts`. The 0061/0065 bodies are rebuilt on it, and the private slot codec in `TighteningResult.ts` is removed. | The property round trips at `test/protocol/Messages.test.ts:159,176` pass with their assertions unchanged; `bun run check` and `bun run test` green. |
| P1 First slice: 0064 → 0065 | complete | Definition module (MID number, per-revision Schemas, reply map), the codec for definitions, and typed `request` in `RequestReply` and `DeviceConnection`, all proven on 0064 → 0065. `GapRecovery` switches to the typed call. The old path still serves the other MIDs during this phase. | `request(RequestOldResult.rev(1), { tighteningId })` returns `OldResult` revision 1, pinned by `expectTypeOf`; the GapRecovery tests are green. |
| P2 Migrate built-ins | complete | Every other built-in becomes a definition. The handshake, keep-alive and `ResultRecovery` use the typed call. `wireFormat`, `decoderFor`, `dataOf`, `midOf`, `revisionOf`, the closed `Mid` literals, `request(message, mid, direct?)` and `expectReply` are removed. `packages/cli` and `apps/ui` are fixed where the break forces it. | No old-path code remains (`rg "wireFormat\|expectReply\|revisionOf" packages` is empty); the whole suite is green. |
| P3 Decode fallback and simulator | complete | Body decode failures and undefined revisions become `UnknownMessage` plus a warning, and the session survives. A pending dedicated reply at an undefined revision gets `UnexpectedRevision`. The simulator answers `0004` to MIDs it doesn't model. | A test for each path; header errors still end the session (existing tests). |
| P4 Example MID and docs | complete | One example custom MID (at least two revisions and a declared reply) with codec round trips and a typed request over the in-memory transport. README sections for defining and requesting a MID. JSDoc rubric pass on every new export. | Full verification matrix in `SPEC.md` green. |
| P5 PR to mergeable | complete | Open a pull request and drive it to mergeable: required checks green, review comments answered and resolved. | `mergeStateStatus` is `CLEAN`; zero unresolved review threads. |
| P6 Close | complete | Write the closeout reflection, flip packet state, and resume `typed-subscriptions`. | Packet status and evidence are updated; a closeout reflection exists; `goals/typed-subscriptions` is set `active`. |

<!--
Phase ids must match ops/manifest.json `phases[]`. A packet may use its own
scheme (milestones, sub-phases, prose), but its plan must never contradict its
own manifest.
-->

## What Landed

- **P1 and P2 landed together.** The `Mid` tests had already proven the
  exact per-revision and reply types, so every built-in moved onto the
  definitions in one rewrite of `Messages.ts` instead of a transitional
  0064-only path. The 0064 → 0065 slice exit still holds:
  `test/connection/TypedRequest.test.ts` pins `request(RequestOldResultMid.rev(1), …)`
  to `OldResult` over the simulator, and `GapRecovery` uses that call.
- **The body decode fallback came with the new codec** (`decodeMessage`
  returns `UnknownMessage` plus a warning), so P3 is left with
  `UnexpectedRevision` tests and the simulator's `0004`.
- **Forced test changes:**
  - `Messages.test.ts`: `decodeMessage` is now an Effect, the closed `Mid`
    literal check became a check against `builtIns`, and the truncated-0061
    test now expects the `UnknownMessage` fallback (decision
    `undefined-revision-falls-back`).
  - `GapRecovery.test.ts` drives a real `RequestReply` instead of a stub.
  - `Shutdown.test.ts` calls the typed `request`.
- **The simulator refuses** a MID it does not model with `0004` code 99, and
  a known MID at a revision it does not define with code 97. Both codes are
  "unknown MID" and "MID revision unsupported" in the specification's error
  table.
- **The example MID is illustrative** (MIDs 9100/9101, `ToolStatus`), as the
  SPEC allows: the specification PDF could not be read in this environment
  (no PDF text tooling), so no real layout was confirmed. It is labelled as
  such in the test and in the README.
- **JSDoc:** all 47 Examples in the touched modules were extracted and
  type-checked against the package.
- **One transient `next build` crash** (SIGILL inside Bun) went away on
  retry; the two runs after it built cleanly.
- **P5:** [PR 7](https://github.com/dichioniccolo/effect-open-protocol/pull/7)
  is `CLEAN`/`MERGEABLE`, with zero review threads. The repository has no CI
  workflows, so there are no required checks; the full matrix ran locally.
- **P6:** the reflection is at `history/reflections/2026-09-19-claude.md`.
  Checklist item 4 (activating `typed-subscriptions`) waits for PR 7 to be
  merged. That packet's resume condition is the merge, not merge-readiness.
- **Built-in definitions are named `<Message>Mid`**
  (`RequestOldResultMid.rev(1)`), because the message classes keep their
  names.

## Sequencing Rationale

- **P0 first.** The field codec has no I/O, and the hardest real layouts
  (0061/0065) already have property tests to prove it against.
- **P1 is the first vertical slice from `MAP.md`.** It takes one real
  request/reply pair through every layer (field, definition, codec, typed
  request) before anything else migrates. If the type-level design is going to
  sprawl, it shows here, while the appetite cuts are still cheap.
- **P2 removes the old path in one sweep,** once the new one is proven.
  Coexistence is limited to P1.
- **P3 changes session behaviour.** It lands after the migration, so the only
  thing it changes is the decode fallback.
- **P4 documents** a mechanism that no longer moves.

Appetite cuts, if needed, in order: the cumulative `extend` helper, then
mapped reply revisions for the built-ins. Record either cut in `README.md`
Notes and in the PR.

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
4. Flip `goals/typed-subscriptions` from `paused` to `active` (manifest and
   README).

## Execution Notes

- Preserve unrelated worktree changes.
- Keep `SPEC.md` normative and update it only when the contract changes.
- Keep this plan current; archive old run outputs under `history/`.
- Validate Effect v4 APIs against `.repos/effect` (run
  `bash scripts/setup-effect-ref.sh` if it is missing), not training-data
  priors.

## Verification Commands

```sh
bun run check
bun run test
bun run lint
bun run format:check
bun run build
test "$(wc -m < goals/typed-mid-definitions/GOAL.md)" -le 4000
jq . goals/typed-mid-definitions/ops/manifest.json
git diff --check -- goals/typed-mid-definitions
```
