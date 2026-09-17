# Capture

<!--
Stage 0. Append-only raw dump: thoughts, links, screenshots (drop files in
assets/ and reference them), half-sentences, contradictions. Nobody tidies
this file; cleaning it up destroys provenance. New material goes under a new
dated heading at the bottom.
-->

## 2026-09-17

User dump (verbatim):

> non importare questi asset ma leggili solo. Questo è quello che voglio fare.
> Utiliza tsdown e non tsup per la build, tutto il resto va bene cosi com'è.

External development plan — **read, not imported** (per user instruction the
files are not copied into `assets/`). Source directory at capture time:
`/mnt/d/Users/nicky/Downloads/openprotocol-effect-plan/openprotocol-effect-plan/`

| File | Topic |
| --- | --- |
| `00-INDEX.md` | Index + reading order; ask the user on real controller behavior |
| `01-contesto-e-regole.md` | Tech-assessment context, motivation, priorities, non-goals, quality rules |
| `02-architettura-e-stack.md` | Stack, layered architecture, Effect primitive usage, repo layout |
| `03-protocollo-e-framing.md` | Open Protocol subset, 20-char header, framer, encoder, protocol errors |
| `04-connessione.md` | Connection state machine, reconnect, keep-alive, request/reply, Scope |
| `05-consegna-risultati.md` | Handler-then-ACK, at-least-once, bounded dedup, backpressure |
| `06-pool-e-scalabilita.md` | DevicePool (build) + horizontal-scale ADR (analysis only) |
| `07-simulatore-e-demo.md` | Effect controller simulator, seeded fault injection, chaos demo |
| `08-testing.md` | @effect/vitest, TestClock, property tests, e2e invariant |
| `09-readme-e-presentazione.md` | README outline, NestJS vs Effect, 7 ADRs, AI usage |
| `10-fasi-e-definition-of-done.md` | Phases 1–8 + Definition of Done |

Reading notes (so a cold session does not depend on the external path):

- Goal: TypeScript library, **Effect only**, talking Open Protocol over TCP to
  tightening controllers; robust to network failure; simulator to prove it.
  Working name `effect-open-protocol`. Tech assessment graded on quality,
  presentation, motivation, technical choices, "stupiscici" — not size.
- Motivation: author already runs a NestJS (non-Effect) equivalent in
  production. Clean rewrite, no code ported from it. Tightening results are
  traceability data: never lost, never double-counted.
- Process rule: design first (MIDs, state machine, correlation, delivery
  semantics, public API, open questions for the user), stop for confirmation,
  then implement phase by phase with tests.
- Priorities: Correctness > Clarity > Testability > Idiomatic Effect > Demo >
  Features.
- Non-goals: multi-instance scale-out (ADR only), leader election/consensus,
  full Open Protocol, durable DB persistence, external brokers, NestJS/other
  DI, web dashboard/auth/Docker/cloud.
- Quality: strict TS, no `any`, documented typed API, no `throw` for expected
  errors, no global mutable state, resources via `Scope`, deterministic tests
  (no real sleeps), small modules.
- Layers: DevicePool → DeviceConnection (state machine, keep-alive, reconnect,
  request/reply, subscriptions) → pure Protocol codec (framing, header, MID
  Schemas) → Transport service (TCP | in-memory). Simulator separate.
- Protocol: ASCII, 20-char header (Length 4, MID 4, Revision 3, No-ack 1,
  Station 2, Spindle 2, Sequence 2, Parts 1, Part no. 1), optional data, NUL
  terminator. MID subset: comm start/ack, comm stop, command accepted/error,
  keep-alive, subscribe/unsubscribe last tightening result, last tightening
  result (id, status, torque, angle, timestamp), result ACK. Details flagged
  "to verify" with user + spec. Unsupported MID → typed error or logged
  ignore, never crash. Framer pure over accumulated state, Length-delimited,
  max buffer, corrupt data ⇒ close + reconnect. Invariant decode(encode(m))=m.
  Errors: MalformedHeader, InvalidLength, UnsupportedMid, PayloadDecodeError,
  FrameTooLarge.
- Connection states: Disconnected → Connecting → Handshaking → Subscribing →
  Ready; failures → WaitingToReconnect (backoff) → Connecting; close() →
  Closing → Closed (final). State observable. Reconnect via Schedule
  (exponential, cap, jitter, configurable, infinite by default, reset on
  success, restore subscriptions). Keep-alive on idle outbound, silent-death
  timeout. One in-flight request at a time; in-flight fail with
  ConnectionLost; unexpected replies logged+dropped. Per-attempt Scope.
  Errors: ConnectionFailed, ConnectionLost, HandshakeRejected, RequestTimeout,
  CommandRejected(code), ConnectionClosed.
- Delivery: `onResult: (r) => Effect<void, HandlerError>`; decode → dedup →
  handler → ACK only on success. At-least-once, documented. Dedup key
  controller id + result id, bounded last-N set, not restart-safe ⇒ handler
  must be idempotent. Bounded backpressure. Controller behavior on missing ACK
  to verify with user. Replay-from-id optional, only if user confirms.
- Pool: one supervised fiber per device, runtime add/remove, failure
  isolation, aggregate state, clean shutdown. Scale-out ADR: static
  partitioning / lease / cluster; maybe tiny `DeviceOwnership`.
- Simulator (Effect): TCP + in-memory, handshake/keep-alive/subscriptions,
  increasing result ids, resend un-ACKed, idle-timeout close. Seeded faults:
  abrupt close, silent socket, delayed replies, split chunks, coalesced
  frames, command rejection, temporary connection refusal.
- Chaos demo: one command, N simulators + pool, random faults, summary table;
  success = generated == unique delivered, lost = 0. Flags `--seed`,
  `--duration`, `--devices`, `--fault-rate`; CLI is thin.
- Tests: @effect/vitest, TestClock, in-memory integration, one localhost TCP
  smoke, property tests for chunked framing and roundtrip, full matrix per
  module, e2e "zero lost, zero duplicated to handler".
- README: problem, motivation, what/what-not, quick start, API example,
  architecture, Effect-primitive rationale, NestJS vs Effect (co-written with
  user), 7 ADRs, limits, tests, AI usage, learnings.
- Phases: 1 design (stop) · 2 protocol + minimal simulator · 3 connection ·
  4 results · 5 pool + TCP · 6 faults + demo · 7 hardening · 8 docs.
  DoD ends with clean `install / test / build / demo` run.
- Stack as written: Node.js, `effect`, `@effect/platform(-node)`,
  `@effect/cli`, `@effect/vitest`, Vitest, **tsup or equivalent** — overridden
  by the user: **tsdown**.
