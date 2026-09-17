# Research

<!--
Stage 1. Ground the capture in reality. Two halves: what exists outside the
repo (cited), and what exists inside it (so we compose bricks instead of
rebuilding them). Date sections; research goes stale.
-->

## External Landscape (2026-09-17)

### Build: tsdown (user-mandated, replaces tsup)

- tsdown is a library bundler built on Rolldown, with declaration generation
  powered by Oxc — [tsdown.dev](https://tsdown.dev/),
  [guide](https://tsdown.dev/guide/), repo
  [rolldown/tsdown](https://github.com/rolldown/tsdown).
- Requires Node.js `^22.18.0 || ^24.11.0 || >=26.0.0`
  ([getting started](https://tsdown.dev/guide/getting-started)). Constraint
  for the "clean machine" DoD run.
- LLM-oriented docs at `https://tsdown.dev/llms.txt` (per tsdown.dev); re-check
  config API at implementation time.

### Open Protocol (Atlas Copco)

- Spec PDFs are publicly hosted, e.g.
  [Open Protocol Specification R2.8.0 (Tulip CDN mirror)](https://s3.amazonaws.com/co.tulip.cdn/OpenProtocolSpecification_R280.pdf),
  [ServAid spec](https://servaid.atlascopco.com/AssertWeb/en-US/AtlasCopco/Document/10268853/GetFile).
  Plan rule: implement subset, describe in own words, cite, do not reproduce.
- Search summaries identify: 20-byte header; MID 0001 Application
  Communication Start, MID 0002 its ACK; MID 9999 keep-alive; 0060/0061/0062
  for last-tightening-result subscription/data/ack
  ([pensare.io client article](https://www.pensare.io/articles/building-a-python-client-for-atlas-copco-open-protocol-torque-tools/),
  [Industrial Monitor Direct PLC note](https://industrialmonitordirect.com/blogs/knowledgebase/implementing-atlas-copco-open-protocol-on-allen-bradley)).
  Keep-alive guidance seen: controller idle timeout 15 s, send ~every 7 s.
  **Unverified against the spec PDF** — Phase 1 design must confirm field
  widths (plan says Revision 3 chars), MID numbers (0003 stop, 0004 command
  error, 0005 command accepted, 0063 unsubscribe) and ACK/resend behavior
  with the user.

## In-Repo Capability Inventory (2026-09-17)

Repo `effect-flow` is an agent-tooling scaffold: no `src/`, no `docs/`.
`package.json` pins `effect@4.0.0-rc.115`, `@effect/vitest@4.0.0-rc.115`,
`vitest@^5`, `typescript@^7`, Bun runtime (`CLAUDE.md`). Effect reference
source linked at `.repos/effect` (MIT).

Plan primitive → Effect v4 location (verified in `.repos/effect`):

| Plan need | v4 brick | Path |
| --- | --- | --- |
| Services / DI (`Context.Tag` in plan) | `Context.Service` + `Layer` | `packages/effect/src/Context.ts`, `Layer.ts` |
| Socket abstraction | `Socket` service, `Socket.make`, typed `SocketError` | `packages/effect/src/unstable/socket/Socket.ts:57,180,471` |
| Simulator server | `SocketServer` | `packages/effect/src/unstable/socket/SocketServer.ts` |
| Node TCP client/server | `NodeSocket.makeNet` / `layerNet`, `NodeSocketServer.make/layer` (`@effect/platform-node`) | `packages/platform/node-shared/src/NodeSocket.ts:90,505`, `NodeSocketServer.ts:69,89` |
| Bun TCP | `@effect/platform-bun` exposes WebSocket only in `BunSocket.ts`; raw TCP NOT FOUND there (Bun runs node:net, so node-shared impl likely applies) | `packages/platform/bun/src/BunSocket.ts:29,46` |
| CLI for demo (`@effect/cli` in plan) | `effect/unstable/cli` (`Command`, `Flag`, `Argument`) | `packages/effect/src/unstable/cli/` |
| Stream / Channel / Pull framing | `Stream`, `Channel`, `Pull` | `packages/effect/src/Stream.ts` etc. |
| Schema, branded ids, tagged errors | `Schema`, `Schema.TaggedError`, `Brand` | `packages/effect/src/Schema.ts`, `Brand.ts` |
| Backoff | `Schedule.exponential`, `jittered`, `upTo`, `spaced` | `packages/effect/src/Schedule.ts:850,1093,1294,1198` |
| Correlation, queues, state | `Deferred`, `Queue`, `Ref`, `SubscriptionRef`, `Semaphore`, `Latch` | `packages/effect/src/*.ts` |
| Per-device supervision | `FiberMap`, `FiberSet`, `FiberHandle`, `LayerMap`, `RcMap` | `packages/effect/src/*.ts` |
| Test time | `TestClock` | `packages/effect/src/testing/TestClock.ts` |
| Property tests | `it.prop` in `@effect/vitest`; schema arbitraries | `packages/vitest/src/index.ts:265`, `packages/effect/src/internal/arbitrary/` |
| Cluster (ADR option 3) | `effect/unstable/cluster` | `packages/effect/src/unstable/cluster/` |
| Open Protocol codec, simulator, pool, delivery | NOT FOUND — NET-NEW | — |

## Constraints Discovered

1. **Plan is Effect v3-shaped, repo is Effect v4.** `@effect/platform`,
   `@effect/cli`, `Context.Tag`, `Data.TaggedError` naming in the plan map to
   `effect/unstable/socket`, `effect/unstable/cli`, `Context.Service`,
   `Schema.TaggedError` in v4. Plan itself says "verify APIs on current docs,
   adapt and flag" — so this is adaptation, not a scope change. Socket/CLI
   live under `unstable/` (API may move between RCs).
2. **Runtime/tooling conflict.** Plan: Node.js + `npm install/test/build/demo`.
   Repo `CLAUDE.md`: Bun (`bun run test`, `bunx`). tsdown needs Node ≥22.18
   regardless. Decide target runtime and DoD commands.
3. **Project home.** Plan names repo `effect-open-protocol`; current repo is
   `effect-flow` agent scaffold. Decide: build here, or new repo seeded with
   this tooling.
4. Open Protocol details remain "to verify" (plan-owned); Phase 1 design stop
   is the checkpoint, not this exploration.
5. Spec is Atlas Copco-owned: cite, do not reproduce text in repo.
