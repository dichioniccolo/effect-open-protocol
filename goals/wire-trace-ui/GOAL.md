# GOAL: keep the wire trace and show it in a browser

Repo root: the current working directory — the checkout you are running in. Do not assume an absolute path; several checkouts exist. All paths
below are repo-relative.

Outcome: the controller and client CLIs record every traced packet to
`.wire-trace/traces.sqlite`, and a Next.js app in `ui/` (Bun, Tailwind,
Effect atoms) lists runs, filters their packets, shows raw plus decoded
header, and tails live runs, with history surviving restarts.

This is a compact goal launcher. Treat the packet files as the detailed
contract:

- `goals/wire-trace-ui/README.md`
- `goals/wire-trace-ui/SPEC.md`
- `goals/wire-trace-ui/PLAN.md`
- `goals/wire-trace-ui/ops/manifest.json`

Read those first, then read `CLAUDE.md` and any governing
standards named by `SPEC.md`. Higher-priority repo standards outrank packet
prose when they conflict.

Scope:

- In: root `package.json` workspace conversion, new `store/` and `ui/`
  packages, `cli/Wire.ts`, `cli/controller.ts`, `cli/client.ts`,
  `.gitignore`, tests, `README.md`, and the dependencies named in `PLAN.md`.
- Out: anything in `src/` beyond reading existing exports, MID body
  decoding, run pairing, any UI write path, export, search, auth,
  deployment. Full list in `SPEC.md` Non-Goals.

Workflow:

1. Inspect referenced files and current repo state.
2. Make the smallest change that satisfies `SPEC.md`.
3. Preserve unrelated user/worktree changes.
4. Keep decisions tied to evidence from files, tests, docs, or command output.
5. Update packet evidence/status if the implementation changes readiness.
6. At P8 Close, write a closeout reflection to
   `history/reflections/<YYYY-MM-DD>-<agent>.md` via the `/reflect` skill (see
   `PLAN.md` P8 Closeout Checklist).

Watch for:

- P1 is a gate: Next on Bun must read SQLite via `@effect/sql-sqlite-bun`.
  If the bundler fights back, switch to the fallback in `SPEC.md` (Bun
  `HttpApi` server plus `AtomHttpApi`), record it, continue.
- The sink sits on the send path. It only enqueues; a scoped fiber writes in
  batches and flushes on Ctrl-C.
- Atoms are Effect v4 (`effect/unstable/reactivity`, `@effect/atom-react`).
  Check APIs in `.repos/effect`, not v3 docs.

Acceptance:

- [ ] `SPEC.md` acceptance criteria are satisfied.
- [ ] Required verification commands pass, or unrelated failures are reproduced
      and recorded separately.
- [ ] No unrelated refactors or formatting churn.

Verification:

```sh
bunx tsc --noEmit
bun run test
bun run build
(cd ui && bun run build)
test "$(wc -m < goals/wire-trace-ui/GOAL.md)" -le 4000
jq . goals/wire-trace-ui/ops/manifest.json
git diff --check -- goals/wire-trace-ui
```

Stop and report before changing public API, schema, data migration, auth, infra,
security behavior, dependencies, lockfiles, generated files, or destructive
state unless `SPEC.md` explicitly requires it. `SPEC.md` does require new
dependencies, a lockfile change, the workspace conversion and a SQLite schema
with migrations.

Done only when acceptance passes and verification is complete, or when a blocker
is reported with file/command evidence.
