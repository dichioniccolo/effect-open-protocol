# GOAL: Build effect-open-protocol per the confirmed plan

Repo root: the current working directory — the checkout you are running in. Do not assume an absolute path. All paths below are repo-relative.

Outcome: an Effect v4 Open Protocol library with resilient connections, ACK-after-handler at-least-once delivery, device pool, seeded fault-injecting simulator and chaos demo (lost = 0), tsdown build and README, shipped as a mergeable PR.

This is a compact launcher. The contract lives in:

- `goals/effect-open-protocol/README.md`
- `goals/effect-open-protocol/SPEC.md`
- `goals/effect-open-protocol/PLAN.md`
- `goals/effect-open-protocol/ops/manifest.json`
- `goals/effect-open-protocol/research/SOURCES.md`

Read those first, then `CLAUDE.md`, the effect-first-development and schema-first-development skills, and the exploration `explorations/effect-open-protocol/` (`BRIEF.md`, `CAPTURE.md`, `DECISIONS.md`). Repo standards outrank packet prose.

Scope:

- In: root tooling (`package.json`, tsconfig, vitest, tsdown config, lockfile), `src/`, `simulator/`, `demo/`, `test/`, `README.md`, this packet.
- Out: SPEC non-goals — scale-out implementation, full protocol, persistence, brokers, other DI frameworks, dashboards/Docker/cloud, NestJS code, tsup, Effect v3 packages.

Workflow:

1. Find the current phase in `PLAN.md` and `ops/manifest.json`.
2. P0 Design: set up tooling, write `research/DESIGN.md`, then STOP and ask the user to confirm it. Do not write protocol code before confirmation.
3. Each later phase: implement the smallest change satisfying SPEC for that phase, with its tests; verify Effect APIs in `.repos/effect`.
4. Never invent controller behavior; ask the user.
5. Keep `PLAN.md` phase status, manifest phases and README current phase in sync; append new decisions to the SPEC decision log.
6. At P9 Close, write a reflection via `/reflect`.

Acceptance:

- [ ] `SPEC.md` acceptance criteria are satisfied.
- [ ] Verification passes, or unrelated failures are reproduced and recorded.
- [ ] No unrelated refactors or formatting churn.

Verification:

```sh
bunx tsc --noEmit
bun run test
bun run build
test "$(wc -m < goals/effect-open-protocol/GOAL.md)" -le 4000
jq . goals/effect-open-protocol/ops/manifest.json
git diff --check -- goals/effect-open-protocol
```

Stop and report before changing public API after design confirmation, adding runtime dependencies beyond SPEC's exception ledger, or anything destructive, unless `SPEC.md` requires it.

Done only when acceptance passes and verification is complete, or a blocker is reported with file/command evidence.
