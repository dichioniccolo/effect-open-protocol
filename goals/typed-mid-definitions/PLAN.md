# Typed MID Definitions Plan

## Status

Status: `pending`

## Phases

| Phase | Status | Goal | Exit criteria |
| --- | --- | --- | --- |
| P0 Field codec | pending | Public `Field.*` module: fixed-width fields as Schemas, with and without parameter IDs, filler fields, and enum digits, over `Ascii.ts`. The 0061/0065 bodies are rebuilt on it, and the private slot codec in `TighteningResult.ts` is removed. | The property round trips at `test/protocol/Messages.test.ts:159,176` pass with their assertions unchanged; `bun run check` and `bun run test` green. |
| P1 First slice: 0064 → 0065 | pending | Definition module (MID number, per-revision Schemas, reply map), the codec for definitions, and typed `request` in `RequestReply` and `DeviceConnection`, all proven on 0064 → 0065. `GapRecovery` switches to the typed call. The old path still serves the other MIDs during this phase. | `request(RequestOldResult.rev(1), { tighteningId })` returns `OldResult` revision 1, pinned by `expectTypeOf`; the GapRecovery tests are green. |
| P2 Migrate built-ins | pending | Every other built-in becomes a definition. The handshake, keep-alive and `ResultRecovery` use the typed call. `wireFormat`, `decoderFor`, `dataOf`, `midOf`, `revisionOf`, the closed `Mid` literals, `request(message, mid, direct?)` and `expectReply` are removed. `packages/cli` and `apps/ui` are fixed where the break forces it. | No old-path code remains (`rg "wireFormat\|expectReply\|revisionOf" packages` is empty); the whole suite is green. |
| P3 Decode fallback and simulator | pending | Body decode failures and undefined revisions become `UnknownMessage` plus a warning, and the session survives. A pending dedicated reply at an undefined revision gets `UnexpectedRevision`. The simulator answers `0004` to MIDs it doesn't model. | A test for each path; header errors still end the session (existing tests). |
| P4 Example MID and docs | pending | One example custom MID (at least two revisions and a declared reply) with codec round trips and a typed request over the in-memory transport. README sections for defining and requesting a MID. JSDoc rubric pass on every new export. | Full verification matrix in `SPEC.md` green. |
| P5 PR to mergeable | pending | Open a pull request and drive it to mergeable: required checks green, review comments answered and resolved. | `mergeStateStatus` is `CLEAN`; zero unresolved review threads. |
| P6 Close | pending | Write the closeout reflection, flip packet state, and resume `typed-subscriptions`. | Packet status and evidence are updated; a closeout reflection exists; `goals/typed-subscriptions` is set `active`. |

<!--
Phase ids must match ops/manifest.json `phases[]`. A packet may use its own
scheme (milestones, sub-phases, prose), but its plan must never contradict its
own manifest.
-->

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
