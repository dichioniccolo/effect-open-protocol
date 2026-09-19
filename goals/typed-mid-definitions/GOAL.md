# GOAL: define MIDs as typed Schemas with typed replies

Repo root: the current working directory — the checkout you are running in. Do not assume an absolute path; several checkouts exist. All paths
below are repo-relative.

Outcome: a user defines an Open Protocol MID in code with one exact type per
revision and a declared reply; `connection.request(Def.rev(n), payload)` returns
exactly that reply type; every built-in MID uses the same mechanism and the old
codec and untyped `request` are gone.

This is a compact goal launcher. Treat the packet files as the detailed
contract:

- `goals/typed-mid-definitions/README.md`
- `goals/typed-mid-definitions/SPEC.md`
- `goals/typed-mid-definitions/PLAN.md`
- `goals/typed-mid-definitions/ops/manifest.json`

Read those first, then read `CLAUDE.md` and any governing
standards named by `SPEC.md`. Higher-priority repo standards outrank packet
prose when they conflict.

Scope:

- In: `packages/open-protocol` (`src/protocol/`, `src/connection/`,
  `src/results/ResultRecovery.ts`, `src/index.ts`,
  `simulator/ControllerBehaviour.ts`, tests), README sections, and only the
  fixes in `packages/cli` / `apps/ui` that the API break forces.
- Out: subscriptions and `ResultDelivery` (the `typed-subscriptions` goal),
  runtime-loaded definitions, revision negotiation, a MID catalogue, simulator
  handlers, generic dedup. Full list in `SPEC.md` Non-Goals.

Workflow:

1. Inspect referenced files and current repo state.
2. Make the smallest change that satisfies `SPEC.md`.
3. Preserve unrelated user/worktree changes.
4. Keep decisions tied to evidence from files, tests, docs, or command output.
5. Update packet evidence/status if the implementation changes readiness.
6. At P6 Close, write a closeout reflection to
   `history/reflections/<YYYY-MM-DD>-<agent>.md` via the `/reflect` skill (see
   `PLAN.md` P6 Closeout Checklist).

Watch for: P1 (0064 → 0065 end to end) is where type-level cost shows. If it
sprawls, cut the `extend` helper, then mapped reply revisions; never widen the
types. Existing 0061/0065 round-trip assertions must not change.

Acceptance:

- [ ] `SPEC.md` acceptance criteria are satisfied.
- [ ] Required verification commands pass, or unrelated failures are reproduced
      and recorded separately.
- [ ] No unrelated refactors or formatting churn.

Verification:

```sh
bun run check && bun run test && bun run lint && bun run format:check && bun run build
test "$(wc -m < goals/typed-mid-definitions/GOAL.md)" -le 4000
jq . goals/typed-mid-definitions/ops/manifest.json
git diff --check -- goals/typed-mid-definitions
```

Stop and report before changing public API, schema, data migration, auth, infra,
security behavior, dependencies, lockfiles, generated files, or destructive
state unless `SPEC.md` explicitly requires it. Note that `SPEC.md` does require
a breaking public API change: typed `request` replaces the old one.

Done only when acceptance passes and verification is complete, or when a blocker
is reported with file/command evidence.
