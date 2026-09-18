# Research

<!--
Stage 1. Ground the capture in reality. Two halves: what exists outside the
repo (cited), and what exists inside it (so we compose bricks instead of
rebuilding them). Date sections; research goes stale.
-->

## External Landscape

### 2026-09-18, prior art for the product shape

Atlas Copco ships two desktop tools in this space. The **Open Protocol
Interface Tester** connects over TCP/IP, sends and receives messages,
subscribes to results and status, and shows traffic "in both raw and decoded
views"
([open-protocol-interface-tester.software.informer.com](https://open-protocol-interface-tester.software.informer.com/)).
The **Open Protocol Tester** builds, sends, receives and analyses MID messages
in real time, with timestamped trace sessions, filters, search and log export
([open-protocol-tester.software.informer.com](https://open-protocol-tester.software.informer.com/)).

What follows for this packet. The expected shape of a viewer here is a
timestamped message list, a raw view next to a decoded view, filtering by MID
and direction, and sessions you can go back to. Both vendor tools are single
GUI clients that sit on one end of the link. Neither shows both ends of one
conversation side by side, which is what a controller trace plus a client
trace in one store would give us.

### 2026-09-18, Next.js on Bun, and `bun:sqlite` inside it

- `bun --bun run dev` runs the Next.js server on the Bun runtime rather than
  Node, and Bun APIs become usable in route handlers. Bundling stays with
  Next's own bundler (Turbopack when enabled); Bun handles process execution
  and module resolution
  ([DEV, Bun compatibility in 2026](https://dev.to/alexcloudstar/bun-compatibility-in-2026-what-actually-works-what-does-not-and-when-to-switch-23eb)).
  The same article says App Router, Server Components and route handlers work
  on Bun, that middleware's edge sandbox can behave differently, and it still
  recommends "Bun as the package manager, Node.js as the runtime" until a
  project has validated its own package set.
- Importing `bun:sqlite` through Next's bundler fails with
  `UnhandledSchemeError: Reading from "bun:sqlite" is not handled by plugins
  (Unhandled scheme)`
  ([oven-sh/bun#4350](https://github.com/oven-sh/bun/issues/4350)). The
  reported workaround is listing `bun:sqlite` under `serverExternalPackages`
  so the bundler leaves it alone
  ([vercel/next.js discussion #55272](https://github.com/vercel/next.js/discussions/55272)).
  Whether that holds for `@effect/sql-sqlite-bun`, which imports
  `bun:sqlite` from inside a dependency, is unverified. It needs a spike.
- There is an official `nextjs/adapter-bun` that turns a production build into
  a Bun-run server, itself keeping an ISR cache in `bun:sqlite`. It routes
  SQLite access through an internal HTTP endpoint rather than importing
  `bun:sqlite` in edge-oriented paths. The package is marked private and its
  license was not stated
  ([github.com/nextjs/adapter-bun](https://github.com/nextjs/adapter-bun)).
  That it avoids direct imports is itself a hint about where the friction is.

So there are two shapes for "Next UI reads a Bun-only SQLite file":

1. **Next on Bun.** One process. Route handlers or server components open the
   database through `@effect/sql-sqlite-bun`, with `bun:sqlite` kept external.
   It depends on the bundler workaround holding.
2. **A small Bun data server next to Next.** A Bun process owns the database
   and serves an HTTP API (and a live feed). Next runs wherever it likes and
   the UI talks to that API, possibly through `AtomHttpApi`. Two processes, but
   no bundler question.

### 2026-09-18, live updates in the App Router

Route handlers can return a `ReadableStream` with
`Content-Type: text/event-stream`, which is enough for Server-Sent Events; the
browser consumes it with `EventSource`
([Next.js, streaming guide](https://nextjs.org/docs/app/guides/streaming),
[DEV, SSE in the App Router](https://dev.to/aon_infotech_3a1b6ff525fc/streaming-responses-in-nextjs-app-router-server-sent-events-and-readablestream-1kab)).
SSE is one-way, server to browser, which fits a viewer that only watches.

### 2026-09-18, atoms and the App Router

The effect-atom docs describe a Hydration module for serialising atom state on
the server and rehydrating it on the client
([Grimoire, Introduction to Effect-Atom](https://llm-grimoire.dev/effect-atom/introduction-and-overview/)).
That page documents the v3-era `@effect-atom/*` packages. For v4 the source of
truth is the vendored Effect source, inventoried below: the hooks and
`HydrationBoundary` files in `@effect/atom-react` carry `"use client"`
directives, so they drop into App Router client components as they are.

## In-Repo Capability Inventory

### 2026-09-18, already built, compose these

| Need | Existing brick | Where |
| --- | --- | --- |
| One traced record per socket op or frame | `WireEvent` schema class: `at`, `source`, `direction`, `kind`, `bytes`, `mid`, `raw` | `src/transport/WireTrace.ts:88-96` |
| Hook for sending records somewhere other than the log | `WireSink = (event) => Effect<void>`, `TraceOptions.sink` | `src/transport/WireTrace.ts:104`, `:112-117` |
| Tracing both ends of a connection | `tracedDuplex`, which wraps any `Duplex` | `src/transport/WireTrace.ts:234-243` |
| Direction and kind literal domains | `WireDirection` (`send`/`recv`), `WireEventKind` (`chunk`/`frame`) | `src/transport/WireTrace.ts:33-60` |
| Lossless raw rendering and back | `escapeWire` / `unescapeWire` | `src/transport/WireEscape.ts` |
| Existing persistent sink, the shape to copy | `traceSink`: opens a JSONL file, appends, swallows write failures with a warning | `cli/Wire.ts:103-122` |
| JSON encoding of a record | `wireEventLine` | `src/transport/WireTrace.ts:269-270` |
| Where both CLIs pick up a sink | `instrument`, `instrumentedTransport` | `cli/Wire.ts:131-163`; used in `cli/controller.ts:113`, `cli/client.ts:70` |
| Decoding a frame into a MID and fields | `Header`, `Messages`, `TighteningResult`, `Framer.step` | `src/protocol/*` |
| SQLite client on Bun, WAL on by default, 5 s busy timeout | `@effect/sql-sqlite-bun` `SqliteClient.layer`, `layerConfig` | `.repos/effect/packages/sql/sqlite-bun/src/SqliteClient.ts:89-118`, `:265-285` |
| Schema migrations | `SqliteMigrator` (Bun), `Migrator` (core) | `.repos/effect/packages/sql/sqlite-bun/src/SqliteMigrator.ts`, `effect/unstable/sql/Migrator` |
| Typed row decoding, SQL models | `SqlSchema`, `SqlModel` | `effect/unstable/sql` |
| Reactive queries off the SQL client | `SqlClient.reactive`, `reactiveMailbox`, driven by `Reactivity` | `.repos/effect/packages/effect/src/unstable/sql/SqlClient.ts:67-80` |
| Atoms, registry, async results | `Atom`, `AtomRegistry`, `AtomRef`, `AsyncResult` | `effect/unstable/reactivity` |
| Typed HTTP or RPC client as atoms | `AtomHttpApi`, `AtomRpc` | `effect/unstable/reactivity` |
| SSR state handoff | `Hydration.dehydrate` / `hydrate`; `HydrationBoundary` | `effect/unstable/reactivity/Hydration`; `.repos/effect/packages/atom/react/src/ReactHydration.ts` |
| React hooks | `useAtomValue`, `useAtom`, `useAtomSet`, `useAtomSuspense`, `useAtomRefresh`, `RegistryProvider` | `.repos/effect/packages/atom/react/src/Hooks.ts`, `RegistryContext.ts` |

### 2026-09-18, gaps

- **Run or session identity: NOT FOUND.** `WireEvent` has no run id,
  connection id or sequence number. `source` is a free string (`"client"`,
  `"controller"`). "Sessions" in the UI have nothing to key on yet.
- **Pairing a controller line with the matching client line: NOT FOUND.** The
  two CLIs are separate processes with separate clocks; nothing links a `send`
  on one side to the `recv` on the other.
- **Any SQL usage in the repo: NOT FOUND.** No `effect/unstable/sql` import,
  no `@effect/sql-*` dependency.
- **Any frontend: NOT FOUND.** No React, Next.js, Tailwind or
  `@effect/atom-react` in `package.json` or `node_modules`.
- **Workspaces: NOT FOUND.** The repo is one package (`package.json`), a
  library published for Node (`engines.node`, `@effect/platform-node`). A Next
  app needs its own home.
- **A decoded-field view of a frame for display: NOT FOUND** as a ready
  function. `src/protocol/*` decodes the MIDs the library speaks, but there is
  no "render any frame as labelled fields" helper.

## Constraints Discovered

1. **`bun:sqlite` only runs on Bun.** Whatever process opens the database has
   to be Bun. Next either runs under `bun --bun` with `bun:sqlite` kept out of
   the bundle (unverified with the Effect driver), or a separate Bun process
   owns the file.
2. **`Reactivity` is process-local.** Its own module doc says so
   (`.repos/effect/packages/effect/src/unstable/reactivity/Reactivity.ts:2`).
   Rows written by the controller and client CLIs cannot invalidate a query in
   the UI's process. A live view needs polling, or a push channel (SSE fed by
   a tail on the newest row id, or the CLIs pushing to the server).
3. **The sink sits on the wire's hot path.** In `tracedDuplex`, `send` runs
   `observe`, which awaits the sink, before `duplex.send`
   (`src/transport/WireTrace.ts:240`). `bun:sqlite` is synchronous, and a
   busy wait blocks the event loop (`SqliteClient.ts:96-99`). A slow or locked
   write would add latency to the very traffic being traced, so writes must be
   queued off that path and batched.
4. **Two writers, one file.** Controller and client run as separate processes.
   WAL (on by default in the driver) allows one writer and concurrent readers;
   the second writer waits on the busy timeout. Fine at this traffic volume if
   writes are batched, but it is a real limit.
5. **The library stays runtime-neutral.** `src/` targets Node and ships
   through `dist/`. A Bun-only SQLite sink belongs in `cli/` (or the new app),
   not in `src/`.
6. **Volume doubles.** Every read or write produces a `chunk` record and every
   completed message a `frame` record, from each side. Retention and indexing
   need thought if runs are long.
7. **Frontend rule changed today.** `CLAUDE.md` now names Next.js, Tailwind and
   Effect atoms for UIs, so none of this is a deviation to justify.
