# GOAL: typed subscriptions, with results delivered through them

Repo root: the current working directory — the checkout you are running in. Do not assume an absolute path; several checkouts exist. All paths
below are repo-relative.

Outcome: `connection.subscribe(Sub.rev(n))` returns a `Stream` of
`{ value, ack }` with `value` exactly typed, restored after every reconnect;
`ResultDelivery` runs on `subscribe(LastResults)` with dedup, gap recovery and
ack-after-handler unchanged.

Precondition: `goals/typed-mid-definitions` is merged. If not, stop: this
packet is paused until then.

This is a compact goal launcher. Treat the packet files as the detailed
contract:

- `goals/typed-subscriptions/README.md`
- `goals/typed-subscriptions/SPEC.md`
- `goals/typed-subscriptions/PLAN.md`
- `goals/typed-subscriptions/ops/manifest.json`

Read those first, then read `CLAUDE.md` and any governing
standards named by `SPEC.md`. Higher-priority repo standards outrank packet
prose when they conflict.

Scope:

- In: `packages/open-protocol` definition module (subscription definitions),
  `src/connection/` (`DeviceConnection`, `Handshake`, `Session` routing),
  `src/results/`, `src/index.ts`, tests, README.
- Out: generic dedup, auto-ack, handler-based subscribe, simulator handlers,
  any change to delivery semantics. Full list in `SPEC.md` Non-Goals.

Workflow:

1. Inspect referenced files and current repo state.
2. Make the smallest change that satisfies `SPEC.md`.
3. Preserve unrelated user/worktree changes.
4. Keep decisions tied to evidence from files, tests, docs, or command output.
5. Update packet evidence/status if the implementation changes readiness.
6. At P6 Close, write a closeout reflection to
   `history/reflections/<YYYY-MM-DD>-<agent>.md` via the `/reflect` skill (see
   `PLAN.md` P6 Closeout Checklist).

Watch for: P0 re-baselines cites written before the prerequisite landed.
`ResultDelivery` moves last (P3); if any Delivery, Chaos, GapRecovery or
Shutdown assertion would need to change, stop and report.

Acceptance:

- [ ] `SPEC.md` acceptance criteria are satisfied.
- [ ] Required verification commands pass, or unrelated failures are reproduced
      and recorded separately.
- [ ] No unrelated refactors or formatting churn.

Verification:

```sh
bun run check && bun run test && bun run lint && bun run format:check && bun run build
test "$(wc -m < goals/typed-subscriptions/GOAL.md)" -le 4000
jq . goals/typed-subscriptions/ops/manifest.json
git diff --check -- goals/typed-subscriptions
```

Stop and report before changing public API, schema, data migration, auth, infra,
security behavior, dependencies, lockfiles, generated files, or destructive
state unless `SPEC.md` explicitly requires it. Note that `SPEC.md` does require
one public API addition: `subscribe`.

Done only when acceptance passes and verification is complete, or when a blocker
is reported with file/command evidence.
