# Brief

<!--
Stage 3. The shaped pitch (Shape Up anatomy). Fat-marker fidelity: concrete
enough to evaluate and decompose, rough enough to leave design latitude to
the implementing goal packets. The exploration is shaped when the human says
this file matches the picture in their head.
-->

## Problem

The wire trace exists and nobody can look at it afterwards.

`bun run controller` and `bun run client` log every chunk and frame they
exchange, and `--trace-file` can append them to JSONL. The log scrolls away
with the terminal. The JSONL file only answers questions you already know how
to `grep` for, and nothing ties a line to the run it came from, because
`WireEvent` has no run id (`RESEARCH.md`, gaps). Once two terminals have been
running for a few minutes, you cannot go back to "what did the handshake look
like on the third reconnect" without scrolling.

Atlas Copco's own testers are built around exactly this view: a timestamped
message list, raw next to decoded, filters by MID and direction, sessions you
can reopen (`RESEARCH.md`, prior art). The repo already produces the data. It
lacks a place to keep it and a screen to read it.

## Appetite

Small batch, a few days.

The budget holds because the write side hangs off a seam that already exists:
`WireSink` in `src/transport/WireTrace.ts` receives every event, and
`cli/Wire.ts` already shows how to build a sink and hand it to both CLIs. What
is new is four dependencies (Next.js, Tailwind, `@effect/atom-react`,
`@effect/sql-sqlite-bun`) and the app itself.

The budget shapes the design:

- one run list, one packet list, one detail pane, nothing else;
- the header is decoded, the MID body is not;
- read-only UI, no delete, no export, no search box beyond simple filters;
- if Next on Bun cannot open SQLite, fall back to a Bun data server on day
  one rather than fighting the bundler.

## Solution Sketch

Three pieces over one file.

```text
  bun run controller ─┐                         ┌─ ui/  (Next.js on Bun)
                      │  SqliteSink (queued,    │    route handlers ── store/
  bun run client ─────┤  batched writes)        │    SSE /api/runs/:id/live
                      ▼                         │    atoms + Tailwind
               .wire-trace/traces.sqlite ◄──────┘
                      ▲
               store/  (schema, migrations, queries on effect/unstable/sql)
```

**`store/`, a workspace package.** Row schemas for `runs` and `events`,
migrations, and the handful of queries both sides need (insert batch, list
runs, page events after an id). Written against core `effect/unstable/sql`
so it has no runtime opinion. Whoever opens the file first runs the
migrations.

- `runs`: id, side (`controller` or `client`), started at, the flags the run
  was launched with (host, port, seed, latency, jitter), ended at when known.
- `events`: autoincrement id, run id, connection number, and the `WireEvent`
  fields as they are (`at`, `direction`, `kind`, `bytes`, `mid`, `raw`).
  Indexed on run id plus id, which is also the live cursor.

**The sink, in `cli/`.** A SQLite `WireSink` next to the JSONL one. Opening
it mints the run id and inserts the `runs` row. Each event is offered to an
in-memory queue and the sink returns at once. A background fiber drains the
queue and writes in one transaction per batch. A failed write logs a warning
and is dropped, the same rule `traceSink` follows, so storage can never take
down or slow the wire. On by default, at `.wire-trace/traces.sqlite`,
overridable with `--trace-db`. The connection number comes from counting
`instrument` calls in the run.

**`ui/`, the Next.js app on Bun.** `bun --bun next dev`, App Router,
Tailwind. Server code reaches the database through `store/` over
`@effect/sql-sqlite-bun`, with `bun:sqlite` kept out of the bundle.

- `/` lists runs, newest first: side, start time, port, event count, and a
  live marker while events are still arriving.
- `/runs/[id]` is the packet list: time, direction arrow, MID, bytes, the
  raw string truncated. Frames only by default, a toggle to show chunks.
  Filters for direction and MID. Clicking a row opens the detail pane.
- The detail pane shows the full escaped raw string and the header decoded
  with `decodeHeader` from `src/protocol/Header.ts`: length, MID, revision,
  ack flag, station, spindle.
- Live: a route handler streams SSE. It polls for events past the client's
  cursor and pushes them. `Reactivity` cannot help here because the writers
  are other processes.

State lives in atoms: the selected run, the event list, the filters, the
selected event and the live feed are atoms that client components read with
`useAtomValue`, with `HydrationBoundary` handing the first page over from the
server.

## Rabbit Holes

1. **`bun:sqlite` through Next's bundler.** `UnhandledSchemeError` is the known
   failure. `serverExternalPackages` is the known workaround, unverified for a
   dependency that imports `bun:sqlite` (`RESEARCH.md`, Next.js on Bun).
   *Patch:* the first slice is a spike that renders one row read through
   `store/` in a server component. If it fails, cut straight to the fallback:
   a Bun process serving an Effect `HttpApi` plus the SSE feed, with Next as a
   pure frontend on `AtomHttpApi`. This is the designated cut.
2. **The sink on the hot path.** `send` awaits the sink before
   `duplex.send`, and `bun:sqlite` blocks on a locked database. *Patch:* the
   queue-and-drain design above; the sink itself only offers to a queue.
3. **Losing the tail on exit.** Ctrl-C ends the run while the queue still holds
   events. *Patch:* the drain fiber is scoped, and scope close flushes what is
   queued before the database closes. Stamp the run's end time in the same
   finaliser.
4. **Two writers.** Controller and client share one file. *Patch:* WAL is on by
   default in the driver, batches are short transactions, and the busy timeout
   absorbs the rest. Migrations race on first open. The migrator takes the
   write lock, so the loser sees them applied, but this gets a test.
5. **SSE in dev.** Long-lived responses, HMR reloads and tab closes can leak
   polling loops. *Patch:* each stream's poll loop ends on the request's abort
   signal, and there is one poll per open stream, not per event.
6. **Atoms and SSR.** Mixing server components, hydration and a registry is new
   to this repo. *Patch:* keep server components to the initial page fetch,
   everything interactive in client components under one `RegistryProvider`,
   and validate the v4 API against `.repos/effect/packages/atom/react`, not v3
   docs.
7. **Workspace conversion.** Turning the root into a workspace root can
   disturb the library build (`tsdown`), the `effect-open-protocol` path
   alias and `bun run test`. *Patch:* convert first, in its own commit, with
   `bunx tsc --noEmit` and `bun run test` green before any UI code.

## No-Gos

- No MID body decoding. The header only.
- No pairing of the controller run with the client run. Each run stands alone.
- No write path in the UI: no delete, no pruning, no annotations.
- No export, no full-text search, no replay.
- No auth, no multi-user, no deployment. It runs on localhost.
- No SQL in `src/`. The library stays runtime-neutral and SQL-free.
- No change to what the tracer emits beyond what the store needs. The run id
  and connection number are added by the sink, not by `WireEvent`.
- No Node fallback for the database. Bun owns the file.
