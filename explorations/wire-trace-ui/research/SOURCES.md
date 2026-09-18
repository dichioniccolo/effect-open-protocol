# Wire-trace UI, sources and provenance

<!--
The provenance ledger for this packet. Start it in the `research` stage and keep
it current through graduate; the graduated goal inherits a copy. Purpose: let an
implementing agent trace every decision back to its origin — a mined source
(repo + file:line), an upstream repo + LICENSE, an external citation, or an
in-repo brick.

RULES
- Never fabricate a URL/DOI/repo link. Reproduce only sources that actually
  appear on disk in RESEARCH.md / research/*.md; if a claim has no on-disk URL,
  cite the RESEARCH.md section that carries it instead.
- Licenses are load-bearing: copyleft (AGPL/GPL/MPL) upstream is CLEAN-ROOM
  reimplement only (pattern, not vendored code); permissive (MIT/Apache/BSD) may
  be ported WITH attribution; missing/unverified LICENSE ⇒ treat as reference
  only. State the discipline per repo.
- Register this file in ops/manifest.json `exploration.sources`.
- Drop a section that genuinely does not apply (e.g. §1/§2 for a greenfield idea
  with no mined corpus) — but keep §3–§5.
-->

- **Cluster and origin:** the research sweep of 2026-09-18. Six web searches
  and two page fetches, covering Open Protocol viewers, Next.js on Bun,
  `bun:sqlite` bundling, SSE in route handlers and effect-atom hydration, plus a
  targeted in-repo inventory of `src/transport/**`, `cli/**` and the vendored
  Effect source under `.repos/effect/packages/{sql/sqlite-bun,atom/react,effect/src/unstable/{sql,reactivity}}`.
- **Provenance:** this packet's [`RESEARCH.md`](../RESEARCH.md). No mined code
  corpus, so section 1 is dropped per the rules above.

## 2. Upstream repositories & licenses

| Repo | License | Port discipline | What we take |
|------|---------|-----------------|--------------|
| Effect-TS/effect (vendored at `.repos/effect`, commit `9ad9891e`, 2026-09-17) | MIT (`.repos/effect/packages/sql/sqlite-bun/LICENSE`) | Dependency, not ported. `@effect/sql-sqlite-bun` and `@effect/atom-react` at 4.0.0-rc.115 get installed as packages | SQLite client, migrator, `Atom`/`AtomRegistry`/`AtomHttpApi`/`Hydration`, React hooks |
| nextjs/adapter-bun | Not stated in the fetched README | Reference only | The observation that it keeps `bun:sqlite` behind an HTTP endpoint instead of importing it in bundled paths |

## 3. External research sources

| Source | Title | Used for | Discipline |
|--------|-------|----------|------------|
| [open-protocol-interface-tester.software.informer.com](https://open-protocol-interface-tester.software.informer.com/) | Open Protocol Interface Tester (Atlas Copco Tools AB) | Prior art: raw and decoded traffic views | Reference only, proprietary |
| [open-protocol-tester.software.informer.com](https://open-protocol-tester.software.informer.com/) | Open Protocol Tester (Atlas Copco Industrial Technique AB) | Prior art: timestamped trace sessions, filters, search, export | Reference only, proprietary |
| [dev.to, Bun compatibility in 2026](https://dev.to/alexcloudstar/bun-compatibility-in-2026-what-actually-works-what-does-not-and-when-to-switch-23eb) | Bun Compatibility in 2026 | Next.js under `bun --bun`: what works, middleware caveat, bundler stays Next's | Reference only |
| [github.com/oven-sh/bun/issues/4350](https://github.com/oven-sh/bun/issues/4350) | UnhandledSchemeError: Reading from "bun:sqlite" is not handled by plugins | The bundler failure mode for `bun:sqlite` in Next | Reference only |
| [github.com/vercel/next.js/discussions/55272](https://github.com/vercel/next.js/discussions/55272) | Docs: Bun runtime support | `serverExternalPackages` workaround | Reference only |
| [github.com/nextjs/adapter-bun](https://github.com/nextjs/adapter-bun) | Next.js deployment adapter for Bun | Bun-run production server; SQLite kept behind HTTP | Reference only, license unverified |
| [nextjs.org/docs/app/guides/streaming](https://nextjs.org/docs/app/guides/streaming) | Next.js, Streaming guide | Route handlers returning streams | Reference only, documentation |
| [dev.to, SSE in the App Router](https://dev.to/aon_infotech_3a1b6ff525fc/streaming-responses-in-nextjs-app-router-server-sent-events-and-readablestream-1kab) | Streaming Responses in Next.js App Router | SSE headers and `EventSource` consumption | Reference only |
| [llm-grimoire.dev, Introduction to Effect-Atom](https://llm-grimoire.dev/effect-atom/introduction-and-overview/) | Introduction to Effect-Atom | Hydration concept (v3-era docs; v4 verified against vendored source) | Reference only |

## 4. In-repo capability references

| Brick | Path | Disposition |
|-------|------|-------------|
| `WireEvent`, `WireDirection`, `WireEventKind` | `src/transport/WireTrace.ts` | reuse; likely extend with a run/connection identity |
| `WireSink`, `TraceOptions.sink`, `tracedDuplex` | `src/transport/WireTrace.ts` | reuse as the write seam |
| `escapeWire` / `unescapeWire` | `src/transport/WireEscape.ts` | reuse for raw display |
| `traceSink` (JSONL), `instrument`, `instrumentedTransport` | `cli/Wire.ts` | reuse the pattern; add a SQLite sink beside it |
| Controller and client CLIs | `cli/controller.ts`, `cli/client.ts` | extend with a database flag |
| Frame decoding | `src/protocol/Header.ts`, `Messages.ts`, `TighteningResult.ts`, `Framer.ts` | reuse for decoded view |
| `@effect/sql-sqlite-bun` `SqliteClient`, `SqliteMigrator` | `.repos/effect/packages/sql/sqlite-bun/src/` | NET-NEW dependency |
| `effect/unstable/sql` (`SqlSchema`, `SqlModel`, `Migrator`, `SqlClient.reactive`) | `.repos/effect/packages/effect/src/unstable/sql/` | reuse (already in `effect`) |
| `effect/unstable/reactivity` (`Atom`, `AtomRegistry`, `AtomHttpApi`, `Hydration`) | `.repos/effect/packages/effect/src/unstable/reactivity/` | reuse (already in `effect`) |
| `@effect/atom-react` hooks, `RegistryProvider`, `HydrationBoundary` | `.repos/effect/packages/atom/react/src/` | NET-NEW dependency |
| Next.js app, Tailwind | none | NET-NEW |

## 5. Cross-links & provenance

- Sibling packet [`explorations/wire-trace-cli/`](../../wire-trace-cli/) and its
  goal [`goals/wire-trace-cli/`](../../../goals/wire-trace-cli/) built the
  tracer and both CLIs this packet reads from.
- This packet's [`RESEARCH.md`](../RESEARCH.md) and, from align on,
  [`DECISIONS.md`](../DECISIONS.md).
- Frontend rule in the repo root `CLAUDE.md`, "Frontend" section, rewritten
  2026-09-18.
