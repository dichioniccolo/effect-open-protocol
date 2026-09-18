# GOAL: ship two commands that make the wire visible

Repo root: the current working directory — the checkout you are running in. Do not assume an absolute path; several checkouts exist. All paths
below are repo-relative.

Outcome: `bun run controller --port 4545` serves a simulated Open Protocol
controller until Ctrl-C, `bun run client --port 4545` connects and receives
results, and both print every raw byte chunk and reassembled frame they send and
receive, with seeded latency available on either side.

This is a compact goal launcher. Treat the packet files as the detailed
contract:

- `goals/wire-trace-cli/README.md`
- `goals/wire-trace-cli/SPEC.md`
- `goals/wire-trace-cli/PLAN.md`
- `goals/wire-trace-cli/ops/manifest.json`

Read those first, then read `CLAUDE.md` and any governing
standards named by `SPEC.md`. Higher-priority repo standards outrank packet
prose when they conflict.

Scope:

- In: `src/transport/` (two new shipped `Duplex` decorators plus an escaping
  helper), `src/index.ts` re-exports, new `cli/controller.ts` and
  `cli/client.ts`, `package.json` scripts, `makeTcp`'s `refuse` path in
  `simulator/ControllerSimulator.ts`, tests, `README.md`.
- Out: the protocol codec, the connection state machine, delivery semantics,
  `demo/chaos.ts`, multi-device support, any new dependency. Full list in
  `SPEC.md` Non-Goals.

Workflow:

1. Inspect referenced files and current repo state.
2. Make the smallest change that satisfies `SPEC.md`.
3. Preserve unrelated user/worktree changes.
4. Keep decisions tied to evidence from files, tests, docs, or command output.
5. Update packet evidence/status if the implementation changes readiness.
6. At P7 Close, write a closeout reflection to
   `history/reflections/<YYYY-MM-DD>-<agent>.md` via the `/reflect` skill (see
   `PLAN.md` P7 Closeout Checklist).

Watch for: the P4 listener rebind is the designated cut. It races `TIME_WAIT`
and touches `makeTcp`'s finalizers. If it resists, revert to the documented
no-op, record why, and ship the rest.

Acceptance:

- [ ] `SPEC.md` acceptance criteria are satisfied.
- [ ] Required verification commands pass, or unrelated failures are reproduced
      and recorded separately.
- [ ] No unrelated refactors or formatting churn.

Verification:

```sh
bunx tsc --noEmit
bun run test
test "$(wc -m < goals/wire-trace-cli/GOAL.md)" -le 4000
jq . goals/wire-trace-cli/ops/manifest.json
git diff --check -- goals/wire-trace-cli
```

Stop and report before changing public API, schema, data migration, auth, infra,
security behavior, dependencies, lockfiles, generated files, or destructive
state unless `SPEC.md` explicitly requires it. Note that `SPEC.md` does require
two additions to the public API, the tracing and latency decorators.

Done only when acceptance passes and verification is complete, or when a blocker
is reported with file/command evidence.
