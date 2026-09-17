# Brief

<!--
Stage 3. The shaped pitch (Shape Up anatomy). Fat-marker fidelity: concrete
enough to evaluate and decompose, rough enough to leave design latitude to
the implementing goal packets. The exploration is shaped when the human says
this file matches the picture in their head.
-->

Normative detail lives in the user's plan (digest: [`CAPTURE.md`](./CAPTURE.md)
2026-09-17). This brief shapes it against repo reality
([`DECISIONS.md`](./DECISIONS.md)); it does not restate every rule.

## Problem

Tightening controllers on a factory floor speak Open Protocol over TCP. Networks
drop, cables get pulled without FIN, controllers restart. A tightening result is
traceability data: losing one or counting it twice is a real defect. The author
already runs a NestJS service solving this in production; timeouts, keep-alive,
reconnect and ACK timing are spread across framework hooks, exceptions and
manual timers, and are hard to test.

The project is a tech assessment with mandatory Effect, graded on quality,
presentation, motivation and technical choices, not size. Question to answer:
does Effect make the hard parts (unstable connections, time, resource
lifecycle, reliable delivery) explicit and testable? Answer it by rewriting the
core from scratch, Effect only, and proving it with a chaos demo a reviewer can
run without hardware.

## Appetite

Assessment-sized: small, polished library, not a product. Budget follows the
plan's 8 phases; each phase lands with its tests before the next starts.
Complexity rule: "does this make the project more interesting to understand, or
just bigger?" If a phase outgrows its tests-plus-docs budget, cut features
(replay-from-id, `DeviceOwnership`, extra faults), never quality.

Hard gate: Phase 1 design doc stops for user confirmation before any code.

## Solution Sketch

```text
app handler ──► DevicePool ──► DeviceConnection ──► Codec (pure) ──► Transport
                (FiberMap)     state machine          framing          TCP (platform-node)
                               keep-alive             header           in-memory (tests)
                               reconnect (Schedule)   MID Schemas
                               request/reply (1 in flight)
                               ResultDelivery (dedup → handler → ACK)

ControllerSimulator (Effect, TCP + in-memory, seeded faults) ◄── tests + chaos demo
```

- **Stack:** TypeScript strict, Effect v4 (`4.0.0-rc.115` pinned),
  `effect/unstable/socket` + `@effect/platform-node`, `effect/unstable/cli` for
  the demo, `@effect/vitest` + `TestClock` + `it.prop`, **tsdown** build. Library
  targets Node; dev commands via Bun (`bun run test|build|demo`), npm documented.
- **Codec:** pure; Length-delimited framer over accumulated state with max
  buffer; encoder inverse; tagged protocol errors; roundtrip + chunking
  property tests.
- **Connection:** explicit state machine tested without I/O; state observable;
  per-attempt `Scope` owns socket and fibers; infinite jittered exponential
  backoff, reset on success, subscriptions restored; idle keep-alive + silent
  death timeout; one in-flight request, others queued, `ConnectionLost` on drop.
- **Delivery:** `onResult: (r) => Effect<void, HandlerError>`; decode → bounded
  per-device dedup → handler → ACK only on success; at-least-once stated
  plainly; bounded backpressure.
- **Pool:** one supervised fiber per device, runtime add/remove, failure
  isolation, aggregate state, full shutdown.
- **Simulator + demo:** seeded faults (abrupt close, silent socket, delays,
  split/coalesced frames, command reject, refuse connects); chaos summary where
  generated == unique delivered and lost = 0.
- **Docs:** README per plan `09`: 7 ADRs, NestJS vs Effect written with the
  user, AI usage, limits, scale-out analysis.
- **Layout:** plan `02` tree adapted: `src/{protocol,connection,results,pool,transport}`,
  `simulator/`, `demo/`, `test/` in this repo; package renamed
  `effect-open-protocol`.

## Rabbit Holes

1. **Effect v4 `unstable/` churn.** Socket/CLI APIs may differ from docs and
   training priors. Patch: pin exact RC, verify against `.repos/effect`, keep
   Transport as our own narrow `Context.Service` so socket API changes stay in
   one adapter.
2. **Open Protocol facts unverified.** MID numbers, Revision width, NACK/resend
   behavior, keep-alive timeout. Patch: Phase 1 design lists them as questions
   for the user; no guessed fields.
3. **Framing edge cases.** Length semantics vs NUL terminator, corrupt data
   resync. Patch: never resync; fail the attempt, reconnect to clean state;
   property tests on arbitrary chunking.
4. **Race: disconnect between handler success and ACK write.** Patch: dedup
   covers resend; e2e test injects exactly this fault.
5. **Deterministic time across fibers.** `TestClock` + socket fibers + Schedule
   jitter can make tests hang or flake. Patch: in-memory transport only for
   timed tests, seeded randomness, one localhost TCP smoke test without timers.
6. **Resource leaks on close() mid-handshake / mid-backoff.** Patch: dedicated
   tests per state; interruption verified via finalizer counters.
7. **tsdown + Bun + Node version matrix.** tsdown needs Node ≥22.18. Patch: set
   `engines`, verify `build` output imports under plain Node in DoD run.
8. **Handler failure semantics.** What controller does without ACK decides
   simulator behavior. Patch: user confirms in Phase 1; simulator encodes it.

## No-Gos

From plan `01`, plus decisions:

- Multi-instance scale-out, leader election, leases, consensus (ADR text only).
- Full Open Protocol coverage.
- Durable result persistence, external brokers (Kafka, RabbitMQ, Redis).
- NestJS or any DI framework other than Effect `Layer`.
- Web dashboard, auth, Docker, cloud deploy.
- Porting code from the NestJS service.
- tsup; Effect v3 packages; Bun-specific runtime APIs inside the library.
- Replay-from-id recovery unless user confirms relevance in Phase 1.
- New runtime dependencies without written justification.
