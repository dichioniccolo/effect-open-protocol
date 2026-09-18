# Decisions

<!--
Stage 2. The grilling log. One entry per resolved branch-closing question,
newest last. Unresolved questions live in ops/manifest.json `openQuestions`
until they land here. Deferred questions get an entry too, marked DEFERRED
with the reason.
-->

## 2026-09-18, appetite

**Question:** How big a bet is the UI?

**Answer:** Small batch, a few days. One run list, one packet list, one
detail pane, and a SQLite sink in the CLIs.

**Rationale:** Recommended and accepted. It matches the size of the sibling
`wire-trace-cli` packet, and four dependencies arrive at once (Next.js,
Tailwind, `@effect/atom-react`, `@effect/sql-sqlite-bun`), so scope should stay
tight while those are learned.

Rejected, big batch. Side-by-side controller and client lanes, decoded fields
for every MID, search and export all fit a later packet once the base works.

## 2026-09-18, live view

**Question:** Should the UI show a run live while the CLIs are still going, or
only browse stored runs?

**Answer:** Both. New packets appear as they are written, and past runs stay
browsable.

**Rationale:** Recommended and accepted. Watching the exchange as it happens
is the reason to have a UI instead of a JSONL file. `Reactivity` is
process-local (`RESEARCH.md`, Constraints 2), so the CLIs' writes cannot
invalidate the UI's queries directly. The live path is therefore a push
channel, SSE from a route handler fed by polling for rows past the newest id
the client has. That is cheap at this traffic volume.

Rejected, history only. Simpler, but a refresh button is a worse log file.

## 2026-09-18, session identity

**Question:** What is one "session" in the UI?

**Answer:** One CLI process run. Each `controller` or `client` launch mints a
run id and stamps every stored event with it. Reconnects inside a run show up
as a connection number within the run.

**Rationale:** Recommended and accepted. It closes the "Run or session
identity: NOT FOUND" gap (`RESEARCH.md`, gaps) with the least machinery, since
the id can be minted where the sink is built in `cli/Wire.ts`, and it matches
what the user launched in a terminal.

Rejected, one TCP connection per session. A run with many reconnects would
split into many sessions.

Rejected, a paired controller and client run. It shows both ends together,
but linking two independent processes needs a shared flag or time-and-port
matching. Kept as a big-batch follow-up.

## 2026-09-18, topology

**Question:** Which process opens the SQLite file for the UI?

**Answer:** Next.js running on Bun (`bun --bun next dev`). Route handlers and
server code open the database through `@effect/sql-sqlite-bun`, with
`bun:sqlite` kept out of the bundle. The first slice is a spike that proves
this. If it fails, fall back to a small Bun data server.

**Rationale:** Recommended and accepted. One process to run and one place for
the data code. The risk is the bundler (`RESEARCH.md`, Next.js on Bun: the
`UnhandledSchemeError` on `bun:sqlite` and the `serverExternalPackages`
workaround, unverified for a dependency that imports `bun:sqlite`). A spike
kills that risk on day one.

Fallback, not rejected: a Bun process serving an Effect `HttpApi` and the SSE
feed, with Next as a pure frontend on `AtomHttpApi`. Two processes, no bundler
question.

## 2026-09-18, writer

**Question:** Who writes packets into SQLite?

**Answer:** Each CLI writes the file directly, through a new SQLite
`WireSink` alongside the existing JSONL `traceSink` in `cli/Wire.ts`. Events go
into an in-memory queue and a background fiber writes them in batches, so the
sink returns at once and a locked database never delays the wire.

**Rationale:** Recommended and accepted. Runs get recorded whether or not the
UI is up, which "history" needs. The queue answers `RESEARCH.md`, Constraints
3: the sink is awaited before `duplex.send`, and `bun:sqlite` blocks on a busy
lock. Two writers on WAL with batched transactions is well inside SQLite's
limits at this volume (Constraints 4).

Rejected, CLIs pushing to the Next server as the only writer. No contention,
but nothing is recorded while the UI is down, and the CLIs gain an HTTP client.

## 2026-09-18, stored granularity

**Question:** Store frames only, or chunks too?

**Answer:** Every `WireEvent` the tracer emits, both kinds, tagged by `kind`.
The UI shows frames by default and can reveal chunks.

**Rationale:** Recommended and accepted. The store mirrors the trace one to
one, so there is no second definition of "what gets recorded", and the
socket-level view the `wire-trace-cli` packet chose on purpose survives.

Rejected, frames only. Half the rows, but fragmentation and coalescing become
invisible.

## 2026-09-18, detail view

**Question:** What does the detail pane show for a selected packet?

**Answer:** The escaped raw wire string plus the generic header fields
(length, MID, revision, ack flag, station and spindle), decoded with the
existing `src/protocol/Header.ts`.

**Rationale:** Recommended and accepted. The header is common to every MID, so
it works for all traffic and reuses code that exists.

Rejected for now, raw only: too little for the price of a UI. Rejected for
now, full per-MID body decoding: it needs a new "render any frame as labelled
fields" helper (`RESEARCH.md`, gaps), which is big-batch work.

## 2026-09-18, app home

**Question:** Where does the Next.js app live?

**Answer:** `ui/` as a Bun workspace. The repo root becomes the workspace root,
and `ui/` has its own `package.json` and imports the library through the
workspace.

**Rationale:** Recommended and accepted. The published library stays free of
Next and React dependencies (`RESEARCH.md`, Constraints 5), and the UI reuses
`WireEvent` and `Header` instead of copying them.

Rejected, a `ui/` folder with no workspace: relative imports into `src/` are
brittle. Rejected, a separate repo: the schema would have to be duplicated or
published.

## 2026-09-18, retention

**Question:** What happens to old runs?

**Answer:** Everything is kept. Nothing prunes, and deleting the `.sqlite`
file resets the history. Pruning is DEFERRED.

**Rationale:** Recommended and accepted. At a few hundred bytes per event,
even long runs stay in megabytes, and the small-batch appetite does not pay
for a policy. DEFERRED: a delete-run button or keep-last-N pruning, to revisit
when the file grows enough to hurt or when the UI gains any write path.

Rejected for now, a delete-run button (adds a UI write path and a confirm
flow) and auto-pruning (a policy to choose and test).

## 2026-09-18, database location

**Question:** How do the CLIs and the UI agree on the database file?

**Answer:** Recording is on by default. Both CLIs write to
`.wire-trace/traces.sqlite` at the repo root (gitignored) unless
`--trace-db <path>` overrides it. The UI reads the same default, or
`WIRE_TRACE_DB`.

**Rationale:** Recommended and accepted. Start the CLIs, start the UI, and the
runs are there. `--trace-file` stays as the opt-in JSONL copy.

Rejected, an opt-in flag. Explicit, but easy to forget, and then the UI is
empty.

## 2026-09-18, schema and migration ownership

**Question:** Where do the table schema and migrations live, and who runs
them?

**Answer:** A small shared workspace package (working name `store/`) holds
the row schemas, the migrations and the queries, written against core
`effect/unstable/sql` so it stays runtime-neutral. The CLIs and the UI both
depend on it and both run migrations on open; the first opener applies them
under SQLite's write lock.

**Rationale:** Recommended and accepted. One definition of the tables serves
the writer and the reader. Only the client layer (`@effect/sql-sqlite-bun`) is
Bun-specific and is provided by each app, so `src/` stays untouched by SQL
(`RESEARCH.md`, Constraints 5).

Rejected, migrations in `cli/`: the UI would have to copy or reach into `cli/`
for row schemas. Rejected, migrations in `ui/`: the CLIs could not record until
the UI had run once, which contradicts the direct-writer decision.
