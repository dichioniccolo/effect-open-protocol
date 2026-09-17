# Effect Open Protocol Spec

## Objective

This repo ships `effect-open-protocol`: a TypeScript library built only with
Effect v4 that talks Open Protocol over TCP to tightening controllers, keeps
each connection alive through network failures, and delivers tightening results
at-least-once with ACK only after the application handler succeeds. A seeded,
fault-injecting controller simulator and a one-command chaos demo prove
"generated == unique delivered, lost = 0". README explains problem, motivation,
Effect usage, ADRs, NestJS vs Effect, AI usage and limits.

Origin and full intent: exploration
[`explorations/effect-open-protocol`](../../explorations/effect-open-protocol/README.md)
— shaped pitch [`BRIEF.md`](../../explorations/effect-open-protocol/BRIEF.md),
plan digest [`CAPTURE.md`](../../explorations/effect-open-protocol/CAPTURE.md),
sequencing [`MAP.md`](../../explorations/effect-open-protocol/MAP.md). The
user's original 11-file plan (read, not imported) is authoritative where the
digest is terse; if its path
`/mnt/d/Users/nicky/Downloads/openprotocol-effect-plan/openprotocol-effect-plan/`
is reachable, read it before each phase.

## Non-Goals

From `BRIEF.md` No-Gos:

- Multi-instance coordination, leader election, leases, consensus. One
  instance owns its devices.
- Full Open Protocol coverage; only the plan's MID subset.
- Durable result persistence; external brokers (Kafka, RabbitMQ, Redis).
- NestJS or any DI framework other than Effect `Context`/`Layer`.
- Web dashboard, authentication, Docker, cloud deployment.
- Porting or copying code from the author's NestJS service.
- tsup; Effect v3 packages (`@effect/platform`, `@effect/cli`); Bun-only
  runtime APIs inside library code.
- (Replay-from-id recovery moved INTO scope by the design stop: MID 0064/0065.)
- Reproducing Atlas Copco spec text (describe in own words, cite).
- New runtime dependencies without written justification.

## Source Hierarchy

1. User objective: the external plan + exploration `DECISIONS.md`.
2. `CLAUDE.md` and required skills (effect-first-development,
   schema-first-development).
3. Governing standards (`standards/`, `.patterns/`).
4. This `SPEC.md`.
5. `PLAN.md`.
6. `GOAL.md`.
7. Supporting `research/`, `ops/`, and `history/` files.

Higher sources outrank lower sources when they conflict.

## Target Surfaces

- Root tooling: `package.json` (rename to `effect-open-protocol`, scripts
  `test`/`check`/`build`/`demo`, `engines`), `tsconfig*.json`,
  `vitest.config.ts`, `tsdown.config.ts`, `bun.lock`.
- `src/{protocol,connection,results,pool,transport}/`, `src/index.ts`.
- `simulator/`, `demo/`, `test/` (or colocated `*.test.ts` per repo config).
- `README.md` and ADRs.
- This goal packet (design doc under `research/DESIGN.md`, evidence under
  `history/`).

## Constraints

- **Stack** (exploration `DECISIONS.md`): Effect v4 pinned exactly
  (`4.0.0-rc.115` or a deliberate pinned bump); sockets via
  `effect/unstable/socket` + `@effect/platform-node`; demo CLI via
  `effect/unstable/cli`; tests via `@effect/vitest` + `TestClock` + `it.prop`;
  build via **tsdown**. Library targets Node ≥22.18; dev commands use Bun.
  Validate every API against `.repos/effect`, not memory.
- **Quality** (plan `01`): strict TS, no `any` without reason, typed documented
  public API, no `throw` for expected errors, no global mutable state, resources
  owned by `Scope`, deterministic tests with no real sleeps, small modules.
  Priorities: Correctness > Clarity > Testability > Idiomatic Effect > Demo >
  Features.
- **Architecture** (plan `02`): pure codec knows nothing of sockets; connection
  depends on a `Transport` service provided by `Layer` (TCP and in-memory).
- **Protocol** (plan `03`): no guessed fields; unsupported MID never crashes;
  bounded framer buffer; corrupt data closes the attempt and reconnects.
- **Connection** (plan `04`): explicit state machine tested without I/O,
  observable state, per-attempt Scope, configurable jittered exponential backoff
  (infinite by default, reset on success, subscriptions restored), idle
  keep-alive + silent-death timeout, one in-flight request, in-flight requests
  fail with `ConnectionLost`.
- **Delivery** (plan `05`): decode → dedup → handler → ACK only on success;
  at-least-once documented; bounded per-device dedup, documented as not
  restart-safe; bounded backpressure; gap recovery per `research/DESIGN.md` §4.3.
- **Inherited risks** (`BRIEF.md` Rabbit Holes → constraints):
  isolate `unstable/` socket API behind own `Transport`; never resync corrupt
  streams; e2e fault for disconnect between handler and ACK; timed tests on
  in-memory transport with seeded randomness; per-state `close()` leak tests;
  `engines` + plain-Node import check for tsdown output; simulator encodes
  user-confirmed missing-ACK behavior.
- Keep additions small: "more interesting to understand, or just bigger?"

## Decision Log

Seeded from exploration
[`DECISIONS.md`](../../explorations/effect-open-protocol/DECISIONS.md)
(2026-09-17): plan-is-scope; build-tool = tsdown; effect-version = v4;
runtime = Node library / Bun dev; project-home = this repo; controller-behavior
DEFERRED to design stop; brief-confirmed; goal-granularity = single goal.
New decisions made during execution are appended below.

| Date | Decision | Rationale |
| --- | --- | --- |
| 2026-09-17 | Graduated as one goal with plan phases in `PLAN.md` | User: fewest goals possible |
| 2026-09-17 | `research/DESIGN.md` confirmed by user (§10 answers) | P0 design gate passed |
| 2026-09-17 | Unacknowledged results are LOST on disconnect (user answer Q1) | Controller does not resend after reconnect |
| 2026-09-17 | MID 0064/0065 gap recovery is in scope (was future work) | Only way to keep the "zero lost" invariant given Q1 |
| 2026-09-17 | Configurable local handler retry before skipping the ACK | Q1 makes a transient handler failure cost traceability data |

## Acceptance Criteria

Plan Definition of Done (`10`), adapted to decisions:

- [ ] Design doc (`research/DESIGN.md`) confirmed by user before Phase 2 code.
- [ ] Codec with robust framing and property tests (roundtrip, arbitrary chunking).
- [ ] Connection state machine tested; handshake, keep-alive, correlation.
- [ ] Reconnect with backoff and subscription restore; silent connection detected.
- [ ] ACK only after handler success (with configurable handler retry); result
      dedup; bounded backpressure.
- [ ] Gap recovery via MID 0064/0065 after reconnect, bounded by `recoveryLimit`.
- [ ] Device pool with failure isolation, runtime add/remove, full shutdown.
- [ ] No resources left open after shutdown (tested).
- [ ] Simulator with reproducible seeded fault injection (TCP + in-memory).
- [ ] Chaos demo prints summary with zero lost results; e2e test asserts zero
      lost, zero duplicated to handler.
- [ ] Tests deterministic, no real waits (one localhost TCP smoke test allowed).
- [ ] README complete: NestJS vs Effect (co-written with user), 7 ADRs, limits,
      AI usage, learnings.
- [ ] Clean run from fresh clone: `bun install && bun run test && bun run build
      && bun run demo`; tsdown output imports under plain Node ≥22.18.
- [ ] Shipped as PR driven to mergeable.
- [ ] No unrelated refactors or formatting churn.

## Verification Matrix

| Check | Command or evidence | Required result |
| --- | --- | --- |
| Types | `bunx tsc --noEmit` | Passes |
| Tests | `bun run test` | Passes, no real sleeps |
| Build | `bun run build` | tsdown emits JS + `.d.ts` |
| Node import | `node -e "import('./dist/index.mjs')"` (adjust to emitted entry) | Loads |
| Demo | `bun run demo -- --seed 1 --duration 30s` | Summary shows lost = 0 |
| Packet launcher size | `test "$(wc -m < goals/effect-open-protocol/GOAL.md)" -le 4000` | Passes |
| Manifest JSON | `jq . goals/effect-open-protocol/ops/manifest.json` | Passes |
| Whitespace | `git diff --check -- goals/effect-open-protocol` | Passes |

## Stop Conditions

- **Design stop:** after the design phase, stop and wait for user confirmation
  of `research/DESIGN.md` before writing Phase 2 code.
- Real controller behavior (MID fields, missing-ACK behavior, keep-alive
  timeout) is unclear: ask the user, never invent.
- A non-goal looks necessary: stop and ask.
- A required Effect v4 API does not exist or behaves differently: adapt design,
  record in decision log, report.
- Required source files are missing or materially contradictory.
- Verification requires credentials, cost, destructive side effects, or policy
  approval not named in this spec.
- The same blocker repeats after reasonable investigation.

## Exception Ledger

| Exception | Scope | Owner | Rationale | Removal condition |
| --- | --- | --- | --- | --- |
| New dev deps: `tsdown`, `@effect/platform-node` | `package.json`, `bun.lock` | user | Mandated by exploration decisions | N/A |
