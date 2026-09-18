# Wire-trace UI spec

## Objective

Every packet the two CLIs exchange is kept, and a browser shows it.

`bun run controller` and `bun run client` record every `WireEvent` they trace
into `.wire-trace/traces.sqlite` by default, one run per process launch. A
Next.js app in `ui/`, running on Bun, lists those runs, shows each run's
packets with filters, shows one packet's raw string and decoded header, and
streams new packets into the open run while the CLIs are still going. Close
everything, start the UI again, and the runs are still there.

Shipped as a pull request driven to mergeable.

Source exploration: [`explorations/wire-trace-ui/`](../../explorations/wire-trace-ui/).
The shaped pitch is [`BRIEF.md`](../../explorations/wire-trace-ui/BRIEF.md),
the decomposition is [`MAP.md`](../../explorations/wire-trace-ui/MAP.md), and
every decision below is recorded with its rejected alternatives in
[`DECISIONS.md`](../../explorations/wire-trace-ui/DECISIONS.md).

## Non-Goals

Carried from the brief's no-gos.

- No MID body decoding. The detail pane decodes the header only.
- No pairing of a controller run with a client run. Each run stands alone.
- No write path in the UI: no delete, no pruning, no annotations. Pruning is
  DEFERRED in the exploration's `DECISIONS.md`.
- No export, no full-text search, no replay.
- No auth, no multi-user, no deployment. Localhost only.
- No SQL in `src/`. The library stays runtime-neutral and free of SQL.
- No change to what the tracer emits beyond what the store needs. The run id
  and connection number are added by the sink, not by `WireEvent`.
- No Node fallback for the database. A Bun process owns the file.

## Source Hierarchy

1. User objective or issue that created this packet.
2. `CLAUDE.md` and required skills (its Frontend section names Next.js,
   Tailwind and Effect atoms).
3. Governing standards (`standards/`, `.patterns/`).
4. This `SPEC.md`.
5. `PLAN.md`.
6. `GOAL.md`.
7. Supporting `research/`, `ops/`, and `history/` files.

Higher sources outrank lower sources when they conflict.

## Target Surfaces

- Root `package.json`: becomes a Bun workspace root with `store` and `ui` as
  members; the library build, path alias and scripts stay as they are.
- `store/`: new workspace package. `runs` and `events` row schemas, two
  migrations via `Migrator.fromRecord`, and the queries both sides use,
  written against core `effect/unstable/sql`.
- `cli/Wire.ts`: a SQLite `WireSink` and a `--trace-db` flag beside the JSONL
  `traceSink` and `--trace-file`.
- `cli/controller.ts`, `cli/client.ts`: wire the new sink in; the run gets its
  id, and each connection gets its number.
- `ui/`: new Next.js App Router app with Tailwind, running under
  `bun --bun next dev`. Pages `/` and `/runs/[id]`, a detail pane, and an SSE
  route handler.
- `.gitignore`: `.wire-trace/`.
- `test/` and `store/` tests.
- `README.md`: a section on recording and the UI.

## Constraints

Carried from the brief's rabbit holes, plus the repo's standing rules.

- **P1 is a gate.** `bun:sqlite` through Next's bundler raises
  `UnhandledSchemeError` unless kept external (`serverExternalPackages`),
  and that workaround is unverified for a dependency that imports
  `bun:sqlite`. If the gate fails, switch to the fallback topology: a Bun
  process serving an Effect `HttpApi` plus the SSE feed, with Next as a pure
  frontend on `AtomHttpApi`. Record the switch in the decision log below.
- **The sink only enqueues.** `tracedDuplex` awaits the sink before
  `duplex.send` (`src/transport/WireTrace.ts:240`) and `bun:sqlite` blocks
  the event loop on a busy lock. The sink offers to a bounded `Queue`; a
  scoped fiber drains it with `Queue.takeBetween` and writes one transaction
  per batch. A failed write logs a warning and is dropped, as `traceSink`
  does. Storage never fails or slows `send`.
- **Nothing is lost on Ctrl-C.** The drain fiber's scope flushes the queue
  before the database closes, and the same finaliser stamps the run's end
  time.
- **Two writers, one file.** WAL is on by default in the driver. Batches are
  short transactions. Concurrent first-open migrations must both succeed,
  proven by a test.
- **`Reactivity` is process-local.** The UI cannot be invalidated by the CLIs'
  writes. Live updates come from an SSE route that polls for events past the
  client's cursor (the `events` autoincrement id) and ends its poll loop on
  the request's abort signal.
- **Migrations load from a record, not a glob.** A bundled Next server has no
  migration directory to scan.
- **Atoms are Effect v4 atoms.** `effect/unstable/reactivity` and
  `@effect/atom-react`. Validate APIs against `.repos/effect`, not v3-era
  `@effect-atom/*` docs.
- **The workspace conversion lands alone and green**, before any UI code, so a
  broken library build has one suspect.
- Effect-first code laws apply (`.claude/skills/effect-first-development`), and
  schema work follows `.claude/skills/schema-first-development`.
- Exported `store/` symbols owe the JSDoc rubric
  (`.patterns/jsdoc-documentation.md`).

## Decisions

Full rationale and rejected options live in the exploration's
[`DECISIONS.md`](../../explorations/wire-trace-ui/DECISIONS.md). Summary:

| Decision | Choice |
| --- | --- |
| Appetite | Small batch, a few days |
| Live view | Live tail and browsable history |
| Session | One CLI process run; connections numbered within it |
| Topology | Next.js on Bun opens SQLite itself; Bun `HttpApi` server as fallback |
| Writer | Each CLI writes directly, queued and batched off the hot path |
| Granularity | Every `WireEvent`, chunks and frames, tagged by kind |
| Detail view | Escaped raw string plus header decoded with `decodeHeader` |
| App home | `ui/` as a Bun workspace member |
| Retention | Keep everything; pruning DEFERRED |
| DB location | On by default at `.wire-trace/traces.sqlite`; `--trace-db` and `WIRE_TRACE_DB` override |
| Schema ownership | Shared `store/` package; every opener runs migrations |
| Storage engine | SQLite via `@effect/sql-sqlite-bun` (user direction, confirmed over JSONL-per-run, Postgres and DuckDB) |
| SSE lifetime (2026-09-18, found in P5) | Each live connection ends after 20 s and `EventSource` resumes from `Last-Event-ID`. Next 16 on Bun fires neither the request abort signal nor the body stream's cancel when a browser disconnects, in dev and in `next start`, so an unbounded feed would poll forever after a tab closed |
| First-page handoff (2026-09-18, found in P4) | Server components render the first page and pass it as encoded JSON; client components show it until their atoms produce values (run list) or seed the run's events atom with it (`useAtomInitialValues`). `HydrationBoundary` was not needed: the polling and live atoms must run in the browser anyway, and seeding a registry value would stop a stream atom from starting |

Every alignment answer was the recommended one. The Frontend section of
`CLAUDE.md` was rewritten on 2026-09-18 to name Next.js, Tailwind and Effect
atoms, so the stack is repo policy, not a packet exception.

## Acceptance Criteria

- [ ] The root is a Bun workspace with `store` and `ui`; `bunx tsc --noEmit`,
      `bun run test` and `bun run build` at the root are unchanged in outcome.
- [ ] `bun run controller` and `bun run client` record to
      `.wire-trace/traces.sqlite` without any flag; `--trace-db <path>`
      redirects; `.wire-trace/` is gitignored.
- [ ] Each process launch inserts one `runs` row (side, start, host, port,
      seed, latency, jitter) and stamps its end time on exit, including
      Ctrl-C.
- [ ] Every chunk and frame the tracer emits lands in `events` with its run
      id and connection number, in order, including the last events before
      Ctrl-C.
- [ ] A sink whose writes fail never fails or delays `send`, proven by a test.
- [ ] Migrations applied twice are harmless, and two clients migrating the
      same new file at once both succeed, proven by tests.
- [ ] `ui/` runs with `bun --bun run dev` and builds with `bun run build`.
- [ ] `/` lists runs newest first with side, start time, port, event count,
      and a live marker while a run is still recording.
- [ ] `/runs/[id]` lists the run's frames with time, direction, MID, bytes and
      truncated raw; a toggle reveals chunks; direction and MID filters work.
- [ ] Selecting a packet shows the full escaped raw string and the decoded
      header (length, MID, revision, ack flag, station, spindle).
- [ ] With a run open, new packets appear without a reload while the CLIs
      run; closing the tab ends the server's poll loop within one connection
      lifetime (20 s), since Next on Bun does not report disconnects.
- [ ] UI state (runs, events, filters, selection, live feed) lives in Effect
      atoms; the first page is server-rendered and the atoms take over in the
      browser.
- [ ] Either P1 passed, or the fallback topology is in place and the switch is
      recorded in this spec's decision log.
- [ ] `README.md` documents recording, `--trace-db`, `WIRE_TRACE_DB`, and how
      to start the UI.
- [ ] No unrelated refactors or formatting churn.

## Verification Matrix

| Check | Command or evidence | Required result |
| --- | --- | --- |
| Type check | `bunx tsc --noEmit` | Passes |
| Tests | `bun run test` | Passes |
| Library build | `bun run build` | Passes |
| UI build | `bun run build` in `ui/` | Passes |
| Recording | Run both CLIs, one result, Ctrl-C both; query the file | Two `runs` rows with end times; `events` complete through the last pre-exit event |
| Persistence | Restart the UI after the above | Both runs listed with correct counts |
| Live tail | Open a run while the CLIs run | New packets appear without reload |
| Packet launcher size | `test "$(wc -m < goals/wire-trace-ui/GOAL.md)" -le 4000` | Passes |
| Manifest JSON | `jq . goals/wire-trace-ui/ops/manifest.json` | Passes |
| Whitespace | `git diff --check -- goals/wire-trace-ui` | Passes |

## Stop Conditions

- Required source files are missing or materially contradictory.
- The implementation would exceed named scope.
- Verification requires credentials, cost, destructive side effects, or policy
  approval not named in this spec.
- The same blocker repeats after reasonable investigation.
- **The P1 gate fails.** Do not fight the bundler past a day. Switch to the
  fallback topology, record it, and continue.
- **The workspace conversion breaks the library build or tests** and the fix
  is not obvious. Stop and report before touching `src/`.

## Exception Ledger

| Exception | Scope | Owner | Rationale | Removal condition |
| --- | --- | --- | --- | --- |
| None | N/A | N/A | N/A | N/A |
