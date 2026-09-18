# Map

<!--
Stage 4. Decomposition into candidate goal packets. This is the graduation
surface: the definition-of-ready in explorations/README.md is checked against
this file. Every major component cites an existing repo capability or is
explicitly marked NET-NEW.
-->

One goal packet. The appetite is a small batch (`DECISIONS.md`, appetite) and
the work is one dependency chain with one acceptance story: run the two CLIs,
open the UI, watch the packets arrive, close everything, reopen the UI, and the
run is still there. The Next-on-Bun spike is a gate inside that goal, not a
packet of its own. If it fails, the goal switches to the fallback topology
already named in `BRIEF.md` and carries on.

## Candidate Goal Packets

| Slug | Mission | Depends on | Capabilities cited |
| --- | --- | --- | --- |
| `wire-trace-ui` | Persist every wire event the controller and client CLIs trace into a shared SQLite file, and ship a Next.js UI (Bun, Tailwind, Effect atoms) that lists runs, pages and filters their packets, shows raw plus decoded header, and tails live runs over SSE. Shipped as a mergeable PR. | `wire-trace-cli` (shipped) | See the capability check below. |

### Capability check

| Component | Existing brick (reuse / extend) | NET-NEW |
| --- | --- | --- |
| Event record | `WireEvent`, `WireDirection`, `WireEventKind` (`src/transport/WireTrace.ts`) reuse as the row payload | `runs` row schema; run id and connection number columns |
| Write seam | `WireSink`, `TraceOptions.sink`, `tracedDuplex` (`src/transport/WireTrace.ts`) reuse | none |
| Sink pattern and wiring | `traceSink`, `instrument`, `instrumentedTransport`, `traceFile` flag (`cli/Wire.ts`); `cli/controller.ts:113`, `cli/client.ts:70` extend | SQLite sink, `--trace-db` flag, per-run id minting, per-connection numbering |
| Off-hot-path batching | `Queue.bounded`, `Queue.takeBetween` (`effect/Queue`) reuse | the drain fiber and flush-on-scope-close |
| SQLite client | `SqliteClient.layer` (`@effect/sql-sqlite-bun`, `.repos/effect/packages/sql/sqlite-bun/src/SqliteClient.ts`) new dependency, not new code | none |
| Migrations | `Migrator.fromRecord` (`effect/unstable/sql/Migrator.ts:384`), `SqliteMigrator.run` / `layer` (`sqlite-bun/src/SqliteMigrator.ts`) reuse. `fromRecord` over `fromGlob`, because a bundled Next server has no migration directory to glob | the two migrations themselves |
| Typed queries | `SqlSchema`, `SqlModel`, `SqlClient` (`effect/unstable/sql`) reuse | the four queries: insert batch, list runs, page events after id, run by id |
| Store package | Bun workspaces | `store/` package, workspace root conversion |
| SSE feed | `Sse.encoder` / `Sse.encode` (`effect/unstable/encoding/Sse.ts`) reuse for framing | route handler that polls past a cursor and ends on abort |
| Header decoding | `decodeHeader`, `Header` (`src/protocol/Header.ts`) reuse | none |
| Raw rendering | `escapeWire` / `unescapeWire` (`src/transport/WireEscape.ts`) reuse; `raw` is stored already escaped | none |
| Client state | `Atom`, `AtomRegistry`, `AsyncResult`, `Hydration` (`effect/unstable/reactivity`) reuse; `useAtomValue`, `RegistryProvider`, `HydrationBoundary` (`@effect/atom-react`) new dependency | the atoms for runs, events, filters, selection, live feed |
| Fallback topology (only if gate fails) | `HttpApi` (`effect/unstable/httpapi`), `AtomHttpApi` (`effect/unstable/reactivity`) reuse | a small Bun server entrypoint |
| App shell | none | `ui/` Next.js App Router app, Tailwind config, three views |

## Sequencing

Inside the goal, in this order. Every phase closes with `bunx tsc --noEmit`
and `bun run test` green at the root, and from phase 2 on with `bun run build`
in `ui/` as well.

1. **Workspace conversion.** The root becomes a Bun workspace root with
   `store/` and `ui/` as members. The library build (`tsdown`), the
   `effect-open-protocol` path alias and the test run must be unchanged.
   Its own commit (`BRIEF.md`, rabbit hole 7).
2. **Gate: Next on Bun reads SQLite.** Scaffold `ui/` (App Router, Tailwind),
   a stub `store/` with one migration and one query, and a server component
   that renders a row read through `@effect/sql-sqlite-bun` under
   `bun --bun next dev` and `next build`. Pass: the page renders. Fail: record
   it in the goal's decision log, switch to the Bun `HttpApi` server plus
   `AtomHttpApi`, and continue from phase 3 on that topology.
3. **Store.** The `runs` and `events` schemas, both migrations via
   `Migrator.fromRecord`, the four queries, and tests against a temp file:
   migrations applied twice are harmless, and two clients migrating at once
   both succeed.
4. **SQLite sink in the CLIs.** A sink in `cli/` that mints the run, queues
   events, drains in batches, flushes on scope close and stamps the run's end.
   `--trace-db`, default `.wire-trace/traces.sqlite`, with `.wire-trace/`
   added to `.gitignore`. Tests: a traced exchange over `InMemoryTransport`
   lands every event in order; a sink whose writes fail never fails `send`.
5. **Views.** Run list, packet list with the frames/chunks toggle and the
   direction and MID filters, detail pane with the raw string and decoded
   header. State in atoms, first page hydrated from the server.
6. **Live.** The SSE route handler and a live-feed atom that appends to the
   event list; a live marker on the run list.
7. **Docs and close.** README section on recording and the UI, JSDoc rubric
   pass on exported `store/` symbols (`.patterns/jsdoc-documentation.md`), full
   verification run, PR to mergeable.

Order follows risk, then dependency. The workspace has to exist before
anything can live in it. The gate goes next because its outcome changes where
the database code runs, and it should cost a day at most, not a week. The
store precedes both of its users. The sink before the views, so the views are
built against real recorded runs. Live last, because it decorates views that
already work.

Optional cuts if the appetite runs out, in this order: the chunks toggle (store
chunks, show frames only), the MID filter, then the live marker on the run
list. Live tailing itself is not a cut; it was a decision (`DECISIONS.md`,
live view).

## First Vertical Slice

Phase 4 lands the first end-to-end slice without any UI polish:

Run `bun run controller` and `bun run client`, let the handshake and one
result pass, Ctrl-C both. `.wire-trace/traces.sqlite` holds two `runs` rows,
one per side, each with an end time, and `events` rows for every chunk and
frame each side traced, in order, including the last ones before Ctrl-C.
Start `bun --bun run dev` in `ui/`, open `/`, and both runs are listed with
their event counts.

Verified by the store tests from phase 3, the sink tests from phase 4, and one
integration test that runs a traced exchange into a temp database and reads it
back through the same queries the UI uses.

## Open Risks Inherited From The Brief

- `bun:sqlite` through Next's bundler may fail even with
  `serverExternalPackages`. It is the gate in phase 2, and the fallback is
  already chosen.
- The sink is awaited before `duplex.send`. It must only enqueue, never touch
  the database inline.
- Ctrl-C can drop queued events. The drain is scoped and flushes on close.
- Two writers and concurrent first-open migrations share one file. WAL, short
  batch transactions and a test for the race.
- SSE poll loops can leak across HMR reloads and closed tabs. Each loop ends
  on the request's abort signal.
- Atoms and SSR are new to this repo. Validate the v4 API against
  `.repos/effect/packages/atom/react`, not v3-era docs.
- The workspace conversion can disturb the library build and path alias. It
  lands alone and green.
- DEFERRED from align: pruning or deleting runs. Out of scope here; reopen this
  exploration at `decompose` when the file size hurts.
