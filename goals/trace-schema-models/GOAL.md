# GOAL: replace the trace store's hand-rolled schema pairs with Effect models

Repo root: the current working directory — the checkout you are running in. Do
not assume an absolute path; several checkouts exist. All paths below are
repo-relative.

Outcome: `packages/store/src/Schema.ts` declares each trace table once as an
`effect/unstable/schema/Model` model, every consumer compiles against the
derived variants, and `check` / `lint` / `test` are green with no behavior
change.

This is a compact goal launcher. Treat the packet files as the detailed
contract:

- `goals/trace-schema-models/README.md`
- `goals/trace-schema-models/SPEC.md`
- `goals/trace-schema-models/PLAN.md`
- `goals/trace-schema-models/ops/manifest.json`
- `goals/trace-schema-models/research/SOURCES.md`

Read those first, then `CLAUDE.md` and the `schema-first-development` skill.
`SPEC.md` carries the exact target shape of the three classes — do not invent a
different one. Repo standards outrank packet prose when they conflict.

Scope:

- In: `packages/store/src/{Schema,WireStore,index}.ts`,
  `packages/cli/src/Recording.ts`, `apps/ui/`, the tests under
  `packages/store/test/` and `packages/cli/test/`, and the JSDoc examples in
  the touched modules.
- Out: `packages/store/src/migrations.ts`, the SQL text itself, the six
  `WireStoreService` operations, `SqlModel.makeRepository`/`makeResolvers`, any
  new dependency, `DateTime` fields, UI json variants, compatibility aliases.

Name mapping: `RunStart` → `Run.insert`, old `Run` → `RunSummary`,
`NewEvent` → `TracedEvent.insert`, `StoredEvent` → `TracedEvent`.
`RunId`, `EventId`, `RunSide`, `EventQuery` unchanged.

Workflow:

1. Validate every `Model` API against `.repos/effect`, never from memory
   (`bash scripts/setup-effect-ref.sh` if that checkout is missing).
2. First slice: `Run` + `RunSummary` end to end, through
   `packages/store/test/WireStore.test.ts`. This settles the `Run.extend`
   variant-loss risk in `SPEC.md` before `TracedEvent` is built on it.
3. Then `TracedEvent`, then the barrel, then the call sites, then the tests and
   JSDoc examples.
4. Make the smallest change that satisfies `SPEC.md`; preserve unrelated
   worktree changes.
5. Keep decisions tied to evidence from files, tests, or command output.
6. At P4 Close, write a closeout reflection to
   `history/reflections/<YYYY-MM-DD>-<agent>.md` via the `/reflect` skill (see
   `PLAN.md` P4 Closeout Checklist).

Acceptance:

- [ ] `SPEC.md` acceptance criteria are satisfied.
- [ ] Required verification commands pass, or unrelated failures are reproduced
      and recorded separately.
- [ ] No unrelated refactors or formatting churn.

Verification:

```sh
bun run check && bun run lint && bun run format:check && bun run test
rg -n "RunStart|NewEvent|StoredEvent" packages apps
git diff -- packages/store/src/migrations.ts
test "$(wc -m < goals/trace-schema-models/GOAL.md)" -le 4000
jq . goals/trace-schema-models/ops/manifest.json
git diff --check -- goals/trace-schema-models
```

Stop and report before touching `migrations.ts`, altering SQL text, changing
the `WireStoreService` operation set, adding a dependency, or if
`Run.extend` does not typecheck — see `SPEC.md` Stop Conditions.

Done only when acceptance passes and verification is complete, or when a
blocker is reported with file/command evidence.
