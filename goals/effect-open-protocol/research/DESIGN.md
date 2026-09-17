# Design — effect-open-protocol (P0)

Status: **confirmed by the user on 2026-09-17** (answers in §10). Two answers
changed the design: unacknowledged results are **lost** on disconnect, so gap
recovery via MID 0064/0065 is in scope, and the handler gets a configurable
local retry.

Spec facts below are described in our own words from the Atlas Copco Open
Protocol Specification R2.8.0
(<https://s3.amazonaws.com/co.tulip.cdn/OpenProtocolSpecification_R280.pdf>;
sections cited as §). Effect APIs were checked in `.repos/effect`
(`effect@4.0.0-rc.115`).

## 1. Protocol subset

### 1.1 Frame

- ASCII. 20-byte header, optional data field, NUL (`0x00`) terminator (§2.2.2).
- `Length` (bytes 1–4) counts header + data, **excludes** the NUL. Range
  `0020..9999`; data field ≤ 9979 bytes (§2.3).
- Header fields, left-to-right: Length 4 · MID 4 · Revision 3 · No-ack flag 1 ·
  Station 2 · Spindle 2 · Sequence 2 · Parts 1 · Part number 1.
- Numeric fields are zero-padded left. Revision: spaces, `000` and `001` all
  mean revision 1. Station/spindle spaces mean 1.
- **Not supported (typed error, not a crash):** link-level sequence numbering
  (MID 9997/9998, sequence field ≠ blank/0), message linking (parts > 1),
  binary data parts (MID 0900).

### 1.2 Supported MIDs

| MID | Rev | Direction | Meaning | Data we model |
| --- | --- | --- | --- | --- |
| 0001 | 1 | integrator → controller | Communication start | none |
| 0002 | 1 | controller → integrator | Communication start accepted | cell id (4), channel id (2), controller name (25) |
| 0003 | 1 | integrator → controller | Communication stop | none |
| 0004 | 1 | controller → integrator | Command error | failed MID (4), error code (2) |
| 0005 | 1 | controller → integrator | Command accepted | accepted MID (4) |
| 0060 | 1 | integrator → controller | Subscribe last tightening result (reliable mode: no-ack flag `0`) | none |
| 0061 | 1 | controller → integrator | Last tightening result | subset, see 1.3 |
| 0062 | 1 | integrator → controller | Tightening result acknowledge | none |
| 0063 | 1 | integrator → controller | Unsubscribe last tightening result | none |
| 0064 | 1 | integrator → controller | Old tightening result upload request | tightening id (10, `0` = latest) |
| 0065 | 1 | controller → integrator | Old tightening result upload reply | subset, see 1.3 |
| 9999 | 1 | both | Keep-alive; controller mirrors it | none |

Any other MID decodes to `UnknownMessage { mid, revision, raw }`. Policy: the
connection logs it at `Warning` with the MID and drops it. Framing is intact,
so the connection stays up.

### 1.3 `TighteningResult` (MID 0061 / 0065 rev 1)

One domain type is decoded from two wire layouts: MID 0061 rev 1 (23
parameters, §5.8.2) and MID 0065 rev 1 (11 parameters, §5.8.6). Both are fixed
layouts of two-digit-id-prefixed parameters; every field we model exists in
both. The decoder validates each parameter id at its fixed offset and extracts:

| Field | Source param | Type |
| --- | --- | --- |
| `deviceId` | added by the library, not on the wire | `DeviceId` (brand) |
| `tighteningId` | 23, 10 digits, ≤ 4294967295 | `TighteningId` (brand, int) |
| `vin` | 04, 25 chars, right-trimmed | `string` |
| `parameterSetId` | 06, 3 digits | `int` |
| `status` | 09 | `"OK" \| "NOK"` |
| `torqueStatus` / `angleStatus` | 10 / 11 | `"Low" \| "OK" \| "High"` |
| `torque` | 15, integer × 100 | `number` (Nm, 2 decimals) |
| `angle` | 19, 5 digits | `int` (degrees) |
| `timestamp` | 20, `YYYY-MM-DD:HH:MM:SS` | `ControllerTimestamp` (brand, pattern-checked string; controller local time, no zone) |

(Parameter ids above are the MID 0061 rev 1 ones; MID 0065 rev 1 uses its own
ids, 01 tightening id, 02 VIN, 03 pset, 05 status, 06/07 torque and angle
status, 08 torque, 09 angle, 10 timestamp, and carries no VIN-less fields we
need.)

Remaining parameters are validated for shape and ignored; the encoder (used by
the simulator) fills them with neutral values. Roundtrip invariant is on the
modeled type: `decode(encode(m)) == m`.

### 1.4 Codec and framing

- `Header` and each message are `effect/Schema` classes; the wire mapping is a
  schema transformation string ↔ message (`S.decodeTo` +
  `SchemaTransformation`). Messages form a tagged union (`S.toTaggedUnion`).
- `Framer`: pure step `(buffer, chunk) → Result<{ buffer, frames }, FramingError>`,
  lifted with `Stream.mapAccum` over the transport byte stream.
  - Needs ≥ 4 bytes to read Length; non-digits → `MalformedHeader`.
  - Length < 20 → `InvalidLength`.
  - Waits for `Length + 1` bytes; byte at `Length` must be NUL, else
    `MissingTerminator`.
  - Buffer can never exceed 10 000 bytes without yielding a frame or an error
    (bounded by the 4-digit Length), so `FrameTooLarge` is structural.
- **Corrupt data policy:** any framing error fails the current connection
  attempt. No resync: TCP has no message boundary to recover to. Reconnect
  restores a clean stream and gap recovery (§4.3) refetches whatever was in
  flight.
- Errors (`S.TaggedError`): `MalformedHeader`, `InvalidLength`,
  `MissingTerminator`, `UnsupportedFeature` (sequence numbers, linking, binary),
  `PayloadDecodeError` (schema issue for a known MID).

## 2. Transport

```ts
class Transport extends Context.Service<Transport, {
  readonly connect: (endpoint: Endpoint) =>
    Effect.Effect<Duplex, ConnectionFailed, Scope.Scope>
}>()("effect-open-protocol/Transport") {}

interface Duplex {
  readonly incoming: Stream.Stream<Uint8Array, ConnectionLost>
  readonly send: (bytes: Uint8Array) => Effect.Effect<void, ConnectionLost>
}
```

- `TcpTransport.layer`: `NodeSocket.makeNet` from `@effect/platform-node`
  (`Socket.reader.pull` → `incoming`, `Socket.writer.write` → `send`). Socket
  errors map to `ConnectionFailed` / `ConnectionLost`. The only module that
  touches `effect/unstable/socket`.
- `InMemoryTransport.layer`: an `InMemoryNetwork` service maps endpoints to
  listeners; a connection is two bounded queues. Close from either side ends
  both streams. The simulator listens on it in tests.
- The socket closes when the per-attempt `Scope` closes.

## 3. Connection

### 3.1 State machine

`ConnectionState` is a tagged union; `transition(state, event)` is a pure
function returning `Result<ConnectionState, InvalidTransition>`, unit-tested
without I/O.

```text
Disconnected ──Connect──► Connecting
Connecting ──Opened──► Handshaking          ──Failed──► WaitingToReconnect
Handshaking ──Accepted──► Subscribing       ──Failed──► WaitingToReconnect
Subscribing ──Subscribed──► Recovering     ──Failed──► WaitingToReconnect
Recovering ──Recovered──► Ready             ──Failed──► WaitingToReconnect
Ready ──Lost(reason)──► WaitingToReconnect
WaitingToReconnect ──RetryDue──► Connecting
any non-final ──CloseRequested──► Closing ──Released──► Closed (final)
```

- Deviation from plan `04`: `close()` goes through `Closing` from every
  non-final state (not `WaitingToReconnect → Closed` directly). One shutdown
  path; `Closing` sends MID 0003 only when a socket is open, best effort with a
  short timeout.
- State payloads: `attempt` (count since last Ready), `lastError`
  (`Option<ConnectionError>`), `retryAt` in `WaitingToReconnect`.
- Exposed as `SubscriptionRef<ConnectionState>` (`get`, `changes` stream).
- Structured logs annotated with `deviceId`, `state`, `mid`.

### 3.2 Lifecycle and reconnect

```text
supervisor fiber (per device):
  forever:
    retry(openSession, reconnectSchedule)   // Connecting → Handshaking → Subscribing → Ready
    runUntilLost(session)                   // Ready → failure
```

- `openSession` runs in a fresh `Scope`: connect, start reader fiber, write
  MID 0001, await 0002 (or 0004 → `HandshakeRejected { code }`), subscribe
  0060 when a result handler exists, await 0005, then run gap recovery (§4.3).
- `reconnectSchedule` default:
  `Schedule.exponential("500 millis")` capped at 30 s via `Schedule.modifyDelay`,
  `Schedule.jittered`, unbounded. Configurable per device.
- Backoff reset is structural: `retry` restarts with a fresh schedule each time
  a session reached `Ready` and later failed.
- When the session scope closes, the socket, reader, writer and keep-alive
  fibers are interrupted and released. `close()` interrupts the supervisor and
  returns after finalizers ran.

### 3.3 Keep-alive and silent death

- Controller drops a connection after 15 s without traffic; spec suggests the
  integrator sends MID 9999 after 10 s of inactivity (§5.28.1).
- Keep-alive fiber: when no frame was **sent** for `keepAliveInterval`
  (default 10 s), send 9999 as a normal request and await the mirror within
  `responseTimeout`.
- Timeout on keep-alive = connection dead even if the socket looks open
  (pulled cable, no FIN) → `ConnectionLost { reason: "KeepAliveTimeout" }`.
- Time uses Effect `Clock`; all timers are testable with `TestClock.adjust`.

### 3.4 Request/reply correlation

- Spec rule: only one outstanding message awaiting 0004/0005/reply at a time
  (§3, "one outstanding message"). Strategy: `Semaphore(1)` around
  *send + await*; other requests wait in order.
- The in-flight slot holds `{ expected: ReplyMatcher, deferred }`.
  Matchers: 0001 → 0002 or 0004(mid=0001); 0060/0063/0003 → 0005(mid) or
  0004(mid); 9999 → 9999. 0004/0005 carry the MID they answer, so mismatches
  are detectable: logged and dropped.
- Await with `Effect.timeoutOrElse(responseTimeout)` → `RequestTimeout`.
  Default `responseTimeout` 5 s (question Q3).
- On session loss, the in-flight deferred and every waiter fail with
  `ConnectionLost` (the deferred is completed from the session finalizer).
- MID 0062 needs no reply, so it bypasses the semaphore.
- Requests while not `Ready` fail fast with `NotReady { state }`; after
  `Closed` with `ConnectionClosed`.

### 3.5 Errors

`ConnectionFailed`, `ConnectionLost { reason }`, `HandshakeRejected { code }`,
`RequestTimeout { mid }`, `CommandRejected { mid, code }`, `NotReady`,
`ConnectionClosed`, `InvalidTransition` (defect: signals a bug, `Effect.die`).

## 4. Result delivery

### 4.1 Flow

```text
reader fiber ── MID 0061 ──► Queue.bounded(resultBuffer) ──► delivery fiber
delivery fiber, one result at a time:
  seen(deviceId, tighteningId)?  yes → send 0062 (re-ACK, handler not called)
                                 no  → onResult(result)
                                         success → mark seen → send 0062
                                         failure → log, no ACK
```

- Reader and delivery run in separate fibers so a slow handler never stops the
  reader from seeing keep-alive mirrors.
- Mark-seen happens **before** the ACK write. If the connection drops between
  handler success and ACK, the controller resends, dedup matches, and we only
  re-ACK.
- The handler is retried locally with a configurable `handlerRetry` schedule
  (default: 3 attempts, exponential from 200 ms, jittered) before we give up on
  the ACK. Rationale: an unacknowledged result is lost once the controller gives
  up (Q1), so a transient handler failure must not cost traceability data.
  After the retries are exhausted we log at `Error` and send no ACK; the
  controller resends up to 3 times (§4.3.3), which is the last chance.

### 4.3 Gap recovery (MID 0064/0065)

Confirmed behavior (Q1): a result the controller gave up on is **not** resent
after reconnect. Recovery is therefore part of the reliability story, not
future work.

```text
Recovering (after 0060 accepted):
  request 0064 with tightening id 0   → 0065 carries the controller's latest id
  missing = (lastDeliveredId + 1) .. latestId       (empty on first connect)
  for each missing id, ascending:
    request 0064 id                   → 0065 result  → deliver through §4.1
                                      → 0004 (id not found) → log, skip, continue
  → Ready
```

- `lastDeliveredId` is the highest id handed to the handler for that device,
  kept next to the dedup set.
- Recovery is bounded by `recoveryLimit` (default 100 ids) so a device that was
  offline for a week cannot stall the reconnect; the remainder is logged.
- On first connect there is no baseline: the latest id is recorded as
  `lastDeliveredId` without fetching history.
- Results pushed while recovery runs are queued normally; dedup makes the
  overlap harmless. Ordering towards the handler is by arrival, not by id.

### 4.2 Semantics

- **At-least-once** towards the application. Exactly-once needs the
  application's cooperation: the handler must be idempotent on
  `(deviceId, tighteningId)` (e.g. a unique constraint). README states this as
  an integration requirement.
- Dedup: per device, bounded insertion-ordered set of the last
  `dedupCapacity` ids (default 1 000, oldest evicted). In memory only: it does
  not survive a process restart.
- Backpressure: `resultBuffer` default 16. When full, the reader waits. If the
  handler stays slow long enough, keep-alive can time out, the connection
  resets and the controller resends; dedup keeps this safe. Documented as the
  "application too slow" behavior.
- Recovery after outages: implemented, see §4.3.

## 5. Pool

- `DevicePool` service backed by `FiberMap<DeviceId>`: one supervisor fiber
  per device (`FiberMap.run`), started on `add`, interrupted on `remove`.
- A device failing never fails the pool: supervisor failures are retried
  forever; defects are logged and the device is marked `Closed` with
  `lastError`.
- Aggregate state: `states: Stream<ReadonlyMap<DeviceId, ConnectionState>>`
  built from each device's `SubscriptionRef`.
- Pool `Scope` close → every device goes through `Closing` → `Closed`.
- No `DeviceOwnership` abstraction: one instance owns the devices it is given.

## 6. Public API (proposed)

```ts
import { Effect, Layer, Stream } from "effect"
import { NodeRuntime } from "@effect/platform-node"
import { DevicePool, TcpTransport, TighteningResult } from "effect-open-protocol"

const onResult = (result: TighteningResult) =>
  Effect.log("tightening", result.tighteningId, result.status)

const program = Effect.gen(function* () {
  const pool = yield* DevicePool
  yield* pool.add({ id: "line-1-tool-3", host: "10.0.0.31", port: 4545 })
  yield* pool.add({ id: "line-1-tool-4", host: "10.0.0.32", port: 4545 })
  yield* pool.states.pipe(
    Stream.runForEach((states) => Effect.log("devices", states))
  )
})

program.pipe(
  Effect.provide(
    DevicePool.layer({ onResult }).pipe(Layer.provide(TcpTransport.layer))
  ),
  NodeRuntime.runMain
)
```

Per-device overrides (optional): `reconnect`, `keepAliveInterval`,
`responseTimeout`, `dedupCapacity`, `resultBuffer`. Single-device use:
`DeviceConnection.make(config)` (scoped) exposes `state` and `close`.

## 7. Simulator and demo (shape only)

- `ControllerSimulator.make({ endpoint, seed, resultInterval, faults })`
  listens on `SocketServer` (TCP) or `InMemoryNetwork`. It answers 0001, 9999,
  0060/0063, pushes 0061 with increasing ids, resends unacknowledged results
  per confirmed behavior (Q1/Q2), and closes after 15 s without traffic.
- Faults use `Random.withSeed`: abrupt close, silent socket, delayed replies,
  split chunks, coalesced frames, command rejection (0004), temporarily
  refusing connections.
- Demo: `effect/unstable/cli` command `demo` with `--seed --duration --devices
  --fault-rate --verbose`; prints the summary; exit code non-zero if lost > 0
  or duplicates reached the handler.

## 8. Module layout

```text
src/
  protocol/   Header.ts Framer.ts Messages.ts TighteningResult.ts ProtocolError.ts
  transport/  Transport.ts TcpTransport.ts InMemoryTransport.ts
  connection/ ConnectionState.ts DeviceConnection.ts RequestReply.ts KeepAlive.ts ConnectionError.ts
  results/    ResultDelivery.ts Dedup.ts ResultRecovery.ts
  pool/       DevicePool.ts
  index.ts
simulator/    ControllerSimulator.ts Faults.ts
demo/         chaos.ts
test/         colocated *.test.ts under src/ and simulator/ + test/integration/
```

## 9. Test plan (per phase)

Mirrors plan `08`: property tests (`it.prop`) for framing under arbitrary
chunking and codec roundtrip; pure transition table tests; `TestClock` tests
for keep-alive, silent death, backoff timings and reset, request timeout;
in-memory integration for handshake, resubscribe, in-flight failure,
`close()` in Ready / WaitingToReconnect / Handshaking with finalizer counters;
delivery tests for ACK-after-success, no-ACK-on-failure, drop-before-ACK
dedup, slow handler; pool isolation/add/remove/shutdown; one localhost TCP
smoke test; e2e chaos invariant.

## 10. Questions — answered 2026-09-17

Answers below are binding; the sections above already reflect them.

1. **Missing ACK (0062).** Spec: controller resends after its response timeout,
   up to 3 times, then considers the connection lost. On your controllers, how
   long is that timeout, and **after reconnect + resubscribe, is the
   unacknowledged result sent again or lost?**
   **Answer: lost.** The controller does not resend after reconnect, so
   recovery via MID 0064/0065 (§4.3) is in scope and the simulator models
   loss, not resend.
2. **Result pacing.** Does the controller push the next 0061 before the
   previous one is acknowledged, or does it queue until ACK?
   **Answer: queues until ACK.** One outstanding result at a time; the result
   buffer is effectively depth 1 and backpressure is a safety net.
3. **Command timeout.** Spec suggests resending a command up to 3 times before
   declaring the connection lost. Use that, or fail the request once and
   reconnect? What response timeout do you use in production?
   **Answer: 5 s, no resend**, timeout → `RequestTimeout`, session reset.
4. **Handler failure.** OK that the library never retries the handler itself
   and relies on controller resend?
   **Answer: retry locally.** Configurable `handlerRetry`, default 3 attempts
   with jittered exponential backoff from 200 ms (§4.1).
5. **Tightening ID.** Can ids reset (controller replaced/reset) or repeat?
   Is a bounded last-1 000 set per device fine for dedup?
   **Answer: default kept**, bounded last-1 000 set per device, plus
   `lastDeliveredId` for gap detection.
6. **Revisions.** Is MID 0061 rev 1 (and 0002 rev 1) enough, or do your
   controllers need a higher revision?
   **Answer: default kept**, rev 1 only (0002, 0061, 0065).
7. **Recovery via MID 0064** (upload old result by id after an outage).
   Relevant for the demo, or future work?
   **Answer: in scope**, see §4.3.
8. **Client already connected** (0004 code 96 on 0001). Retry with backoff like
   any handshake failure?
   **Answer: default kept**, retried with backoff, logged as
   `HandshakeRejected { code: 96 }`.
9. **Link-level sequence numbers (9997/9998)** and generic subscriptions
   (0008/0009): used in your production service?
   **Answer: default kept**, not supported; typed `UnsupportedFeature`.
10. **Timestamp.** Keep the controller's zone-less local timestamp as a
    validated string, or convert with a configured zone?
    **Answer: default kept**, validated zone-less string.
