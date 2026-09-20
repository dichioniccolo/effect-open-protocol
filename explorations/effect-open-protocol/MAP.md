# Map

<!--
Stage 4. Decomposition into candidate goal packets. This is the graduation
surface: the definition-of-ready in explorations/README.md is checked against
this file. Every major component cites an existing repo capability or is
explicitly marked NET-NEW.
-->

Single goal packet (user: "Fai meno goal possibile"). The plan's 8 phases
become phases inside that goal's `PLAN.md`; the Phase 1 design stop becomes a
goal stop condition, not a packet boundary. Every library component is NET-NEW
code composed from Effect v4 bricks (repo has no `src/`); cites are relative to
`.repos/effect/packages/`.

## Candidate Goal Packets

| Slug | Mission | Depends on | Capabilities cited |
| --- | --- | --- | --- |
| `effect-open-protocol` | Deliver the requirements end to end: Effect v4 Open Protocol library (codec, connection, result delivery, pool, TCP + in-memory transport), seeded fault-injecting simulator, chaos demo, README/ADRs; tsdown build; clean DoD run; shipped as mergeable PR. | none | Build/test tooling: root `package.json`, `tsconfig.json`, `vitest.config.ts`; tsdown NET-NEW dev dep. Codec: `effect/src/Schema.ts`, `Stream.ts`, `Channel.ts`, `vitest/src/index.ts:265` (`it.prop`). Transport: `effect/src/unstable/socket/Socket.ts:57,180`, `platform/node-shared/src/NodeSocket.ts:90`, `NodeSocketServer.ts:69`, `Context.ts`. Connection: `Schedule.ts:850,1093`, `Deferred.ts`, `SubscriptionRef.ts`, `Scope.ts`, `Semaphore.ts`, `effect/src/testing/TestClock.ts`. Delivery: `Queue.ts`, `MutableHashSet.ts`. Pool: `FiberMap.ts` (evaluate `LayerMap.ts`/`RcMap.ts`). Demo: `effect/src/unstable/cli/`, `Random.ts`. Docs: `.patterns/jsdoc-documentation.md`, `.claude/skills/quality-review-fix-loop`. Open Protocol codec, connection, delivery, pool, simulator, demo, README: NET-NEW. |

## Sequencing

Inside the goal, strict plan order, each phase closing with green
`bunx tsc --noEmit` + `bun run test`:

1. Design and tooling (Phase 1): tsdown build, package rename, design doc;
   **stop for user confirmation**.
2. Protocol codec + in-memory transport + minimal simulator (Phase 2).
3. Device connection (Phase 3).
4. Result delivery (Phase 4).
5. Pool + TCP transport (Phase 5).
6. Fault injection + chaos demo (Phase 6).
7. Hardening (Phase 7).
8. Docs + DoD run (Phase 8), then PR to mergeable, then close.

Order mirrors layer dependencies: codec has no I/O; connection needs codec +
in-memory transport; delivery needs connection; pool needs delivery; demo needs
pool + TCP; hardening and docs need everything.

Optional cuts if appetite runs out (in order): replay-from-id, `DeviceOwnership`
interface, rarer faults (temporary connect refusal), verbose logging mode.

## First Vertical Slice

Design + tooling phase lands when: `bun run build` produces a tsdown bundle +
`.d.ts` from a placeholder `src/index.ts` importable under plain Node ≥22.18;
`bun run test` and `bunx tsc --noEmit` are green; design doc in the goal packet
covers MID table, state diagram, correlation strategy, delivery semantics, API
example, numbered controller-behavior questions; user confirmed or amended it.

First code slice after the gate: encode a communication-start message, push its
bytes through the in-memory transport split into random chunks, decode it back
equal, proven by `it.prop`.

## Open Risks Inherited From The Brief

- Effect v4 `unstable/` socket/cli API churn → pin RC, verify in `.repos/effect`, isolate behind own `Transport`.
- Open Protocol fields unverified → no guessed fields; Phase 1 questions to user.
- Corrupt frame handling → fail attempt and reconnect, never resync.
- Disconnect between handler success and ACK → dedup + dedicated e2e fault.
- TestClock with socket fibers and jitter → in-memory transport for timed tests, seeded randomness.
- Leaks on close() in every state → per-state tests with finalizer counters.
- tsdown Node ≥22.18 requirement → `engines` + plain-Node import check.
- Handler-failure controller behavior → confirmed in Phase 1, encoded in simulator.
