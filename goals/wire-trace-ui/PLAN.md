# Wire-trace UI plan

## Status

Status: `in-progress`

## Phases

| Phase | Status | Goal | Exit criteria |
| --- | --- | --- | --- |
| P0 Workspace | complete | Make the root a Bun workspace with `store` and `ui` as members. Library build, `effect-open-protocol` path alias and scripts unchanged. Its own commit. | `bunx tsc --noEmit`, `bun run test`, `bun run build` green with the same outcome as before. |
| P1 Gate | complete | Scaffold `ui/` (Next.js App Router, Tailwind) and a stub `store/` with one migration and one query. A server component renders a row read through `@effect/sql-sqlite-bun`, with `bun:sqlite` kept out of the bundle. | The page renders under `bun --bun next dev` and after `next build`. Or the fallback topology (Bun `HttpApi` server plus `AtomHttpApi`) is chosen and recorded in `SPEC.md`. |
| P2 Store | complete | `runs` and `events` schemas, both migrations via `Migrator.fromRecord`, and the four queries: insert batch, list runs, page events after an id, run by id. | Tests against a temp file: round trip, migrations applied twice harmless, concurrent first-open migrations both succeed. |
| P3 Sink | complete | SQLite `WireSink` in `cli/Wire.ts`: mint the run, enqueue, drain in batches with `Queue.takeBetween`, flush and stamp end on scope close. `--trace-db` defaulting to `.wire-trace/traces.sqlite`; per-connection numbering; `.gitignore`. | First vertical slice: both CLIs, one result, Ctrl-C both, and the file holds two ended runs with every event through the last pre-exit one. A failing sink never fails `send`, under test. |
| P4 Views | complete | `/` run list, `/runs/[id]` packet list with the chunks toggle and direction and MID filters, detail pane with raw string and `decodeHeader` fields. State in atoms, first page hydrated. | The recorded runs from P3 browse correctly after a UI restart. |
| P5 Live | pending | SSE route handler polling past a cursor, framed with `Sse` encoding, ending on abort; a live-feed atom appending to the event list; live marker on the run list. | New packets appear without reload while the CLIs run; closing the tab ends the poll loop. |
| P6 Docs | pending | README section on recording, `--trace-db`, `WIRE_TRACE_DB` and starting the UI; JSDoc rubric pass on exported `store/` symbols; full verification run. | Verification matrix in `SPEC.md` green. |
| P7 PR to mergeable | pending | Open a pull request and drive it to mergeable: required checks green, review comments answered and resolved. | `mergeStateStatus` is `CLEAN`; zero unresolved review threads. |
| P8 Close | pending | Write the closeout reflection and flip packet state. | Packet status and evidence are updated; a closeout reflection exists. |

<!--
Phase ids must match ops/manifest.json `phases[]`. A packet may use its own
scheme (milestones, sub-phases, prose), but its plan must never contradict its
own manifest.
-->

## Gate Result

P1 passed on 2026-09-18. A server component read `sqlite_version()` (3.53.0)
through `@effect/sql-sqlite-bun` under both `bun --bun next dev` and
`bun --bun next build` plus `next start`, Next.js 16.3.5 on Turbopack. The
fallback topology is not needed.

Two findings for later phases:

- `serverExternalPackages` must name `bun:sqlite`, not
  `@effect/sql-sqlite-bun`. Next adds every `@effect/*` package to
  `optimizePackageImports`, which Turbopack treats as transpiled, and a
  package cannot be both. `transpilePackages` is not needed for the store.
- `next dev` writes `AGENTS.md` and `CLAUDE.md` into `ui/` when it detects an
  agent; `agentRules: false` turns that off. Its own docs for this version
  live in `ui/node_modules/next/dist/docs/` and outrank training data.

## Sequencing Rationale

Order follows risk, then dependency, from
[`MAP.md`](../../explorations/wire-trace-ui/MAP.md). The workspace has to exist
before anything can live in it. The gate goes next because its outcome decides
where the database code runs, and it should cost a day at most. The store comes
before both of its users. The sink comes before the views, so the views are
built against real recorded runs. Live comes last because it decorates views
that already work.

Optional cuts if the appetite runs out, in this order: the chunks toggle (store
chunks, show frames only), the MID filter, then the live marker on the run
list. Live tailing itself is not a cut.

## P8 Closeout Checklist

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
- Keep `SPEC.md` normative and update it only when the contract changes. A P1
  fallback switch is such a change: record it in the spec's decision table.
- Keep this plan current; archive old run outputs under `history/`.
- New dependencies are in scope and named: `next`, `react`, `react-dom`,
  `tailwindcss`, `@effect/atom-react`, `@effect/sql-sqlite-bun`, pinned to
  the repo's Effect version (4.0.0-rc.115) where they are Effect packages.

## Verification Commands

```sh
bunx tsc --noEmit
bun run test
bun run build
(cd ui && bun run build)
test "$(wc -m < goals/wire-trace-ui/GOAL.md)" -le 4000
jq . goals/wire-trace-ui/ops/manifest.json
rg -n "wire-trace-ui|GOAL.md|agentLaunchers|packetAnchorDocument" goals/wire-trace-ui
git diff --check -- goals/wire-trace-ui
```
