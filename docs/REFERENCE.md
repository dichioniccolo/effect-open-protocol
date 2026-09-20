# effect-open-protocol: full reference

For a one-page overview, read the [README](../README.md).

An Open Protocol client for industrial tightening tools (the controllers),
written only with [Effect](https://effect.website). The library does not manage
the controllers; it only manages the connection to them. It keeps that
connection alive through network failures and delivers every tightening result
to your application exactly once, or tells you when it cannot.

```sh
bun install
bun run test
bun run demo
bun run controller
bun run client
```

## The problem

Assembly lines are full of tightening tools, the controllers, and they speak
[Open Protocol](https://www.atlascopco.com/) over plain TCP. Each
completed tightening produces a result: torque, angle, verdict, timestamp,
and a unique identifier. That result is traceability data. If a car leaves the
line and the bolt torque for it was never recorded, the record is incomplete,
and nobody can tell afterwards whether the bolt was tightened correctly.

Factory networks are not kind. Cables get unplugged mid-shift, switches
reboot, controllers restart, and a socket can stay open for minutes after the
device behind it has gone. Meanwhile the protocol itself offers no correlation
identifier, allows only one outstanding message at a time, drops the
connection after 15 seconds of silence, and gives up on a result it cannot get
acknowledged.

So the hard part of this library is not parsing bytes. It is everything around
the bytes: when to retry, when to give up, what to do with a result whose
acknowledgement never arrived, and how to prove any of it works.

## Why it exists

I already built this service once, in production, with NestJS and without
Effect. This is a rewrite from scratch of its core, with Effect only, to see
how much Effect would help me handle, or avoid entirely, some of the problems I
had with it: unstable connections, time, resource lifetime, reliable delivery.
No code was carried over from the original; see
[NestJS vs Effect](#nestjs-vs-effect).

## What it does

- Connects to any number of controllers, one supervised fiber each.
- Runs the communication start handshake and restores subscriptions after
  every reconnect.
- Sends keep-alives and detects a silent connection, meaning a socket that is
  open but whose peer is gone.
- Reconnects forever with jittered exponential backoff, resetting after a
  successful session.
- Delivers each tightening result to your handler and acknowledges it **only
  after your handler succeeded**.
- Recognises resends and never delivers the same result to your handler twice.
- Fetches results produced while the link was down (MID 0064/0065) and detects
  gaps from the identifiers of incoming results.
- Fails in-flight requests with typed errors as soon as a session dies, instead
  of leaving them waiting for a timeout.
- Closes gracefully: a communication stop goes out before the socket does, so
  the controller releases the client slot instead of waiting out its own idle
  timeout.

## What it does not do

- It does not cover all of Open Protocol, only the subset listed below.
- It does not persist anything. Duplicate detection lives in memory and is lost
  on restart, so **your handler must be idempotent** (see
  [Delivery semantics](#delivery-semantics)).
- It does not coordinate several instances of your service. A controller
  accepts a limited number of clients, so run one instance per set of devices.
- No dashboard, no auth, no Docker, no cloud anything.

## Quick start

```ts
import { Effect } from "effect"
import { NodeRuntime } from "@effect/platform-node"
import { DeviceId, DevicePool, Endpoint, TcpTransport } from "effect-open-protocol"

const program = Effect.gen(function* () {
  const pool = yield* DevicePool

  yield* pool.add({
    id: DeviceId.make("line-1-tool-3"),
    endpoint: new Endpoint({ host: "10.0.0.31", port: 4545 }),
    onResult: (result) =>
      Effect.log(`${result.tighteningId}: ${result.status} ${result.torque} Nm`)
  })

  yield* Effect.never
})

program.pipe(
  Effect.provide(DevicePool.layer),
  Effect.provide(TcpTransport.layer),
  NodeRuntime.runMain
)
```

Your handler receives a decoded `TighteningResult`. Returning successfully
means "I have taken responsibility for this result", and only then is the
acknowledgement sent to the controller. Failing means the result is not
acknowledged.

### Watching the protocol

Two commands put a controller and a client in separate terminals and print
every byte that crosses between them.

```sh
bun run controller -- --port 4545
bun run client     -- --port 4545 --latency 40 --jitter 15
```

The `controller` command runs a simulated controller, which exists only to
test the library. It binds the port and behaves like a real controller: it answers the
handshake, accepts the subscription, pushes results and waits for MID 0062,
serves stored results on MID 0064, and misbehaves when asked. The client is the
library itself, so what you watch is the same code an application would run.
Both stay up until Ctrl-C, then print what they saw.

Every line carries the direction, the byte count, the MID, and the raw wire
string with the NUL terminator and the field padding left visible.

```text
[10:14:16.312] INFO wire frame { source: "client", dir: "send", bytes: 21,
  mid: "0001", raw: "00200001001001010000\0" }
[10:14:16.498] INFO wire frame { source: "client", dir: "recv", bytes: 58,
  mid: "0002", raw: "00570002001001010000010001020103Simulator                \0" }
```

A frame is one complete message; a chunk is what a single socket read or write
carried. They are not the same thing once frames get split or coalesced, so
frames log at info and chunks at debug. Add `--log-level debug` to see the
socket itself.

| Flag | Commands | Meaning |
| --- | --- | --- |
| `--host`, `--port` | both | Where to bind or connect. Defaults to `127.0.0.1:4545`. |
| `--latency`, `--jitter` | both | Milliseconds of delay on this side's writes, drawn per write from `latency ± jitter`. |
| `--seed` | both | Seeds every random decision, so a run replays. |
| `--trace-file` | both | Appends every traced line to a file as JSONL. |
| `--trace-db` | both | SQLite file every traced event is recorded into. Defaults to `.effect-open-protocol/traces.sqlite`. |
| `--device-id` | client | Identifier stamped on received results. Defaults to `tool-1`. |
| `--recovery-interval` | client | Milliseconds between MID 0064 reconciliations. `0`, the default, asks only on session start and on a detected gap. |
| `--fault-rate` | controller | Probability that a frame the controller sends triggers a fault. |
| `--result-interval` | controller | Milliseconds between generated results. `0` produces none on a timer. |
| `--controller-name` | controller | Name reported in the handshake reply. |

The controller's terminal takes three commands, which is how the outage is
driven by hand rather than waited for. They are lines, not keypresses, so each
one ends with Enter. Reading keys would need a raw terminal, and a raw terminal
turns Ctrl-C into a byte instead of a signal, which would leave the command
with no way to stop.

| Typed | What the controller does |
| --- | --- |
| Enter alone | Produces one tightening result immediately. |
| `d`, Enter | Drops the open connection and stops accepting new ones, the way a controller that went away behaves. |
| `u`, Enter | Accepts connections again. |

So gap recovery is four lines. Enter, and a result goes out as MID 0061 and
comes back acknowledged as 0062. `d`, and the client loses the session and
starts retrying on its backoff schedule. Enter twice while it is down, so two
results exist that the client never saw. `u`, and the client reconnects, asks
MID 0064 for the latest result, finds the gap, fetches both with 0064 and 0065,
and delivers them. On Ctrl-C the controller's `generated` equals the client's
`delivered`.

`--fault-rate` is the other way in, and the one the tests use: it breaks things
on its own, at random, from a seed. Its outages are short by design, so for a
demonstration the typed commands are steadier.

Two runs with the same `--seed` and `--trace-file` produce trace files that
`diff` clean, which is what makes a trace usable as evidence. Every `raw` value
round-trips: unescaping it returns the exact bytes the socket carried.

One thing to expect in a side-by-side trace: the simulator stamps its results
with the device id `simulator`, while the client stamps what it decodes with
its own `--device-id`. The same tightening therefore shows two different device
ids, one per side.

### Browsing recorded traffic

Both commands also record every chunk and frame into a SQLite file,
`.effect-open-protocol/traces.sqlite` by default, one run per launch. A small web UI reads
it, so a run can be looked at again after the terminals are gone.

```sh
bun run ui          # Next.js on Bun, http://localhost:3000
```

The first page lists every run, newest first, with its side, port, event count
and whether it is still recording. A run's page lists its frames with the time,
direction, MID and raw string; a toggle adds the socket chunks, and filters
narrow by direction and MID. Selecting a packet shows the full escaped string
and its decoded header. While a run is still going, new packets appear on their
own.

Start the UI from anywhere, before or after the commands: whichever opens the
file first creates it. To look at another file, pass `--trace-db <path>` to the
commands and set `EFFECT_OPEN_PROTOCOL_TRACE_DB=<path>` for the UI. Nothing is ever deleted;
removing the file starts the history over.

Recording never gets in the way of the link. The commands queue events and a
background fiber writes them in batches, so a slow or locked file cannot delay
a send, and a file that cannot be opened or written costs a warning, not the
run. Ctrl-C writes whatever is still queued before the command exits.

The pieces live in three places. `packages/store` holds the tables, migrations
and queries, and both sides use it. `packages/cli/src/Recording.ts` is the sink
the commands write through. `apps/ui` is the Next.js app, which runs on Bun
because the SQLite driver is `bun:sqlite`.

### Running the demo

```sh
bun run demo -- --seed 7 --duration 20 --devices 3 --fault-rate 0.2
```

This starts simulated controllers (the same test-only simulator), connects a
pool to them, injects seeded faults for the given duration, then stops the
faults, lets the run settle, and prints:

Every fault the simulator can decide is one it actually performs: dropped
connections, silent links, delayed replies, frames split across reads, frames
coalesced into one read, refused commands, and a controller that stops
accepting connections while it reboots.

```text
Devices:                  3
Seed:                     7
Results generated:        274
Results delivered:        274
Duplicates discarded:     41
Abandoned by controller:  3
Reconnects pending:       0
Results lost:             0   OK
Delivered twice:          0   OK
```

You can check the success criterion yourself: **generated equals delivered, and
nothing reached the handler twice**. Every random decision comes
from the seed, so a run that fails can be replayed exactly.

## Architecture

```text
        your handler
              ▲
       ┌──────┴───────┐
       │  DevicePool  │   one supervised fiber per device, failures isolated
       └──────┬───────┘
              │
  ┌───────────┴────────────┐
  │   DeviceConnection     │   state machine · keep-alive · reconnect
  │                        │   request/reply · subscription · recovery
  └───────────┬────────────┘
              │
  ┌───────────┴────────────┐
  │   ResultDelivery       │   dedup → handler → acknowledge
  └───────────┬────────────┘
              │
  ┌───────────┴────────────┐
  │   Protocol codec       │   pure: framing · header · MID schemas
  └───────────┬────────────┘
              │
  ┌───────────┴────────────┐
  │   Transport (service)  │   TCP  |  in-memory
  └────────────────────────┘

        ControllerSimulator: a controller with seeded fault injection,
        used by the tests and by the demo
```

The codec is pure and knows nothing about sockets. The connection knows nothing
about TCP: it depends on a `Transport` service provided by a `Layer`, so the
tests run on an in-memory transport and the demo on real sockets, with the same
connection code.

| Module | Role |
| --- | --- |
| `src/protocol` | Header, framer, `Field` (fixed-width fields as Schemas), `Mid` (message definitions), the built-in messages, tightening results |
| `src/transport` | The `Transport` service, TCP and in-memory implementations |
| `src/connection` | State machine, session lifecycle, request/reply correlation, subscriptions |
| `src/results` | Duplicate detection, delivery, gap recovery |
| `src/pool` | Many devices in one process |
| `simulator` | A simulated controller with seeded faults, imported as `effect-open-protocol/simulator/*` |

Paths above are inside `packages/open-protocol`. The rest of the workspace,
run with [Turborepo](https://turborepo.com):

| Workspace | Role |
| --- | --- |
| `packages/open-protocol` | `effect-open-protocol`: the library and its simulator |
| `packages/store` | `@effect-open-protocol/store`: trace tables, migrations, queries |
| `packages/cli` | `@effect-open-protocol/cli`: controller and client commands, the chaos demo, the soak run |
| `apps/ui` | `@effect-open-protocol/ui`: the Next.js trace viewer |

## The protocol subset

Described in my own words from the Atlas Copco Open Protocol specification
(R2.8.0). The specification belongs to Atlas Copco, so I cite it instead of
copying it.

A message is ASCII: a 20-byte header, an optional data field, and a NUL
terminator. The header carries the length (header plus data, terminator
excluded), the MID, its revision, a no-ack flag, station and spindle
identifiers, and fields for link-level sequencing and message linking.

| MID | Direction | Meaning |
| --- | --- | --- |
| 0001 / 0002 | out / in | Communication start and its acceptance |
| 0003 | out | Communication stop |
| 0004 / 0005 | in | Command error (with code) and command accepted |
| 0060 / 0063 | out | Subscribe and unsubscribe to tightening results |
| 0061 | in | A tightening result |
| 0062 | out | Acknowledge a tightening result |
| 0064 / 0065 | out / in | Request and receive a stored result by identifier |
| 9999 | both | Keep-alive, mirrored by the controller |

Anything else decodes into an `UnknownMessage`, which is logged and dropped: an
unexpected MID never breaks a connection. The same goes for a revision the
library does not define and for a data field that does not decode; both are
kept as `UnknownMessage` with a warning that names the MID, the revision and
the reason. A malformed frame is a different matter. A bad length, a missing
terminator or an unreadable header fails the session, and the reconnect gives
us a clean stream, because TCP offers no boundary to resynchronise on.

Link-level sequence numbering (MID 9997/9998), message linking and binary
payloads are unsupported on purpose, and rejected with a typed error rather
than misparsed.

## Defining your own MIDs

The built-in messages above are defined with the same two modules any user
gets: `Field` describes a data field, `Mid` turns layouts into a message
definition. Each revision is its own Schema, so each has its own exact type,
and a request says in its definition which reply every revision expects.

```ts
import { Effect } from "effect"
import { DeviceConnection, Field, Mid } from "effect-open-protocol"

// Illustrative MIDs: 9100 and 9101 and their layouts are made up for this
// example, not taken from the specification.
const statusFields = [
  ["toolId", Field.digits({ id: "01", width: 3 })],
  ["temperature", Field.digits({ id: "02", width: 4 })]
] as const

const ToolStatus = Mid.define({
  tag: "ToolStatus",
  mid: 9101,
  revisions: {
    1: Field.layout(statusFields),
    // Revision 2 appends a field: spread the previous layout's entries.
    2: Field.layout([...statusFields, ["motorHours", Field.digits({ id: "03", width: 6 })]])
  }
})

// A request is a definition plus the reply each revision expects.
const ToolStatusRequest = Mid.request(
  Mid.define({
    tag: "ToolStatusRequest",
    mid: 9100,
    revisions: {
      1: Field.layout([["toolId", Field.digits({ width: 3 })]]),
      2: Field.layout([["toolId", Field.digits({ width: 3 })]])
    }
  }),
  { 1: ToolStatus.rev(1), 2: ToolStatus.rev(2) }
)

const program = Effect.gen(function* () {
  const connection = yield* DeviceConnection.DeviceConnection
  // `reading.motorHours` is a number here; ask for revision 1 and it does not exist.
  const reading = yield* connection.request(ToolStatusRequest.rev(2), { toolId: 7 })
})
```

- **Fields.** `Field.digits`, `text`, `raw` and `enumerated` each return a
  `Field`: a Schema between exactly `width` characters and a typed value
  (its `codec`), with its width and an optional two-digit parameter id. `Field.layout` takes them as an ordered
  array, so wire order never depends on object key order. A bare `filler` is
  written on the wire and never shows up in the value. `digits` and `raw`
  take a `schema` to decode into a branded or refined type.
- **Revisions.** A revision is a `Field.layout` (the value is a plain tagged
  struct) or `Mid.as(Class, layout)` (the value is an instance of your class).
  The class's tag and revision must match the definition's, which the compiler
  checks. `rev(n)` only accepts a revision the definition declares.
- **Replies.** `Mid.request(definition, replies)` names the reply of each
  revision: a revision of any definition (the request's own, for a message the
  controller mirrors), `commandAccepted` (the generic 0005, with 0004 as a
  rejection), or `Mid.noReply`. `request` returns exactly that type. A reply
  is recognised by the MID in the frame header, so a MID the library does not
  model is decoded straight into its declared revision.
- **Errors.** Besides `NotReady`, `RequestTimeout` and `ConnectionLost`, a
  request can fail with:
  - `CommandRejected`: the controller answered 0004.
  - `UnexpectedRevision`: the reply came at a revision the request did not
    declare. It fails straight away instead of waiting for the timeout.
  - `PayloadDecodeError`: the reply's data field did not decode.
  - `PayloadEncodeError`: the payload does not fit its fields. Nothing is
    sent.
- **Limits.**
  - A custom MID the controller pushes arrives typed only while it is
    subscribed (see below); otherwise it is an `UnknownMessage`.
  - The simulator answers any MID it does not model with 0004: code 99 for an
    unknown MID, code 97 for an unsupported revision.

### Subscribing to pushed MIDs

A MID the controller pushes on its own is subscribed to. `Mid.subscription`
names, for each revision of the data MID, the request that starts the pushes,
the MID that acknowledges each one, and the request that stops them (the last
two are optional where the protocol has none). `connection.subscribe` returns
a `Stream` whose elements are `{ value, ack }`, with `value` typed exactly.

```ts
import { Effect, Stream } from "effect"
import { commandAccepted, DeviceConnection, Field, Mid } from "effect-open-protocol"

// Illustrative MIDs, like 9100 and 9101 above.
const bare = (tag: string, mid: number) => Mid.define({ tag, mid, revisions: { 1: Field.layout([]) } })

const SubscribeToolStatus = Mid.request(
  Mid.define({ tag: "SubscribeToolStatus", mid: 9102, revisions: { 1: Field.layout([]), 2: Field.layout([]) } }),
  { 1: commandAccepted, 2: commandAccepted }
)

const ToolStatusSubscription = Mid.subscription(ToolStatus, {
  1: { subscribe: SubscribeToolStatus.rev(1), ack: bare("AcknowledgeToolStatus", 9103).rev(1) },
  2: { subscribe: SubscribeToolStatus.rev(2), ack: bare("AcknowledgeToolStatus", 9103).rev(1) }
})

const watch = Effect.gen(function* () {
  const connection = yield* DeviceConnection.DeviceConnection

  yield* Stream.runForEach(connection.subscribe(ToolStatusSubscription.rev(2)), (pushed) =>
    // `pushed.value.motorHours` is a number. Acknowledge once it is handled.
    Effect.andThen(Effect.log(pushed.value.motorHours), pushed.ack)
  )
})
```

- **Acknowledging.** Nothing is acknowledged for you: run `ack` once the value
  is handled. It is a plain send, never a request, so it never waits behind
  one. A value never acknowledged is sent again by the controller, and the
  stream delivers the resend too: consumers stay idempotent.
- **Lifetime.** Subscribing works in any state: a subscription made while no
  session is up is sent at the next handshake. Every active subscription is
  sent again after each reconnect, and the same stream keeps emitting. It ends
  when the consumer stops, which sends the unsubscribe MID, or when the
  connection closes.
- **Errors.** The stream fails with `CommandRejected` whenever the controller
  refuses the subscription, on a live session or while restoring it after a
  reconnect; the subscription is forgotten and the session carries on. It
  fails with `AlreadySubscribed` when the data MID already has a consumer on
  the connection. The connection's own result subscription keeps the old
  policy: a refused MID 0060 costs the session, and the next one subscribes
  again.
- **Routing.** A frame goes to the request waiting for a reply first, then to
  the subscription of its MID. Pushed values wait in a bounded queue per
  subscription (`subscriptionBuffer`, 16 by default); a slow consumer slows the
  reader.

The full example runs as tests against a scripted controller on the in-memory
transport: the definitions are in `packages/open-protocol/test/example/ToolStatus.ts`,
the request in `ToolStatus.test.ts` and the subscription in
`ToolStatusSubscription.test.ts`.

## Delivery semantics

The system is **at-least-once** towards your handler, and exactly-once in
practice for everything it can control. The order is what matters:

1. A result arrives and is decoded.
2. If we have already delivered that identifier, it is acknowledged again and
   your handler is **not** called.
3. Otherwise your handler runs, retried on failure.
4. Only if your handler succeeded is the result recorded and acknowledged.

If the connection dies between step 4's record and its acknowledgement, the
controller resends and step 2 catches it. If your handler keeps failing, the
result is never acknowledged. The controller resends it three times and then
drops the session.

Tightening results run on the same subscription any MID gets: the connection
subscribes to `LastResults` (MIDs 0060 to 0063) for as long as it lives and
feeds what it pushes into these steps. The acknowledgement is that
subscription's MID 0062, sent after step 4 and never before. Subscribing to
`LastResults` yourself instead of passing `onResult` gets you the raw stream
without any of this: no duplicate detection, no gap recovery, and the
acknowledgement is yours to send.

**A result the controller gives up on is gone**, which is why gap recovery
exists. The library asks for missing results by identifier (MID 0064) and
delivers them through the same path. Three events trigger it: a session
starting, which establishes where the controller stands; the subscription
coming back, which catches what the controller produced during that first pass
and never pushed; and a pushed identifier that jumps ahead of the last one
delivered, which is the gap itself. A healthy link therefore carries two MID
0064 per session and nothing more. Only the controller's "not found" (MID 0004
code 15) writes a result off. Any other refusal, a timeout, or a reply for a
different identifier leaves it pending, and the pass asks again.

Both triggers depend on something arriving, which leaves one case uncovered:
results missed while the session stayed up, with no later tightening to reveal
the gap. Setting `recoveryInterval` closes it by polling, at the price of one
MID 0064 per interval per device for as long as the process runs. It is off
unless asked for. A pass fetches at most `recoveryLimit` results (100 by
default), skipping those already delivered, and further passes follow until
the gap is closed.

Identifiers do not start at zero. The baseline comes from asking the controller
for its latest result on the first connection. If that request fails, the next
pass tries again, and a pushed result arriving before any baseline starts one.
A controller that held nothing when first asked has no history, so its baseline
is where its results start: recovery walks down from its newest result until
the controller answers "not found".

Duplicate detection is exact from the baseline on: everything up to the last
contiguous result is known delivered, and every result delivered above a gap
that has not closed yet is kept. Results older than the baseline rely on a
window of the last 1,000 identifiers per device. None of it survives a restart
of your process. **In production your handler should
be idempotent on `(deviceId, tighteningId)`**. A unique constraint in your
database is the usual answer. This is an integration requirement, not a detail.

Backpressure: results wait in a bounded queue (16 by default). A slow handler
slows the reader rather than growing memory; if it is slow enough for a
keep-alive to time out, the session resets and recovery picks the results back
up.

## How Effect is used

Each primitive is here because it solves a concrete problem in this domain.

| Primitive | The problem it solves here |
| --- | --- |
| `Scope` | A connection attempt owns a socket and three fibers. When the attempt dies, its finalizers fail the pending request and release all four before the next begins. |
| `Layer` / `Context.Service` | `Transport` is a service, so the same connection code runs over TCP or in memory. |
| `Schema` | Every MID payload is decoded and validated at the boundary; identifiers are branded so a device id cannot be passed as a tightening id. |
| `Schema.TaggedError` | Expected failures (`ConnectionLost`, `HandshakeRejected`, `RequestTimeout`, `CommandRejected`) live in the error channel instead of being thrown. |
| `Schedule` | Reconnect backoff (exponential, capped, jittered) and handler retries, both configurable rather than hand-rolled loops. |
| `Deferred` + `Semaphore` | Request/reply correlation for a protocol with no correlation id and only one outstanding message allowed. |
| `Queue` (bounded) | Backpressure between the reader and a slow handler. |
| `SubscriptionRef` | The connection state is observable as a stream of changes. |
| `FiberMap` | One supervised fiber per device; adding and removing devices at runtime is starting and stopping exactly one of them. |
| `Stream` | Bytes to frames to messages, with the framer as a pure step function. |
| `Clock` / `TestClock` | Keep-alive intervals, timeouts and backoff are tested without a single real sleep. |
| `Random.withSeed` | Fault injection is reproducible: the same seed replays the same chaos run. |
| Structured logging | Every log carries the device id, and the state machine annotates transitions. |

## Tests

```sh
bun run test
```

158 tests across 26 files, with no real waiting outside the socket tests.
What they cover:

- **Codec**: every supported MID round-trips; property tests over random
  identifiers, torque and angle values; malformed headers, bad lengths, missing
  terminators and unsupported protocol features each produce their own error.
- **Framing**: a property test feeds three messages through arbitrary chunk
  boundaries and expects exactly those three messages back.
- **State machine**: the whole transition table, including every invalid pair
  and the finality of `Closed`, tested with no I/O at all.
- **Connection**: handshake, subscription, keep-alive timing, silent-link
  detection, backoff after a rejected handshake, retry until a controller
  appears, requests refused before ready and after close, closing from several
  states, all under `TestClock`.
- **Delivery**: acknowledgement only after the handler succeeds, no
  acknowledgement when it fails, retry of a flaky handler, duplicate
  recognition, backpressure with a slow handler, bounded dedup window.
- **Pool**: several devices at once, failure isolation, duplicate rejection,
  removal, per-device delivery.
- **Integration**: delivery over a connection, recovery of results produced
  while the link was down, a real localhost TCP smoke test, shutdown and
  resource release, and the chaos invariant on two seeds.

The chaos test carries the most weight. Under seeded faults, generated equals
delivered and nothing reaches the handler twice. It found three real
defects that the unit tests could not reach. See [What I
learned](#what-i-learned).

### Tested on a real controller

Besides the simulator, the library ran against a real controller, a Rexroth
Nexo tightening tool, with the `client` command. That session is in the
repository, so you can check every claim below against the bytes instead of
taking it on trust:

```sh
EFFECT_OPEN_PROTOCOL_TRACE_DB=../../docs/traces/nexo.sqlite bun run ui
```

One run, 142 recorded events, 71 of them frames, four minutes of a real
controller on a real WLAN. What it shows, with the timestamps it carries:

1. **16:01:33, the baseline.** MID 0001 goes out, 0002 comes back. Then MID
   0064 with id 0, whose 0065 reply carries 2636, the controller's latest
   result. That becomes the baseline, so older results count as history.
   Subscription with MID 0060, accepted with 0005.
2. **16:01:52, a tightening.** It arrives as MID 0061 with id 2637. The client
   delivers it to the handler, and only then sends the MID 0062
   acknowledgement.
3. **The outage.** I switched the controller's WLAN off and made seven
   tightenings while it was down. The keep-alive sent at 16:02:13 never got an
   answer, and the client declared the session lost one `responseTimeout`
   later. The trace then goes quiet. With the network down there is nothing to
   record, because the reconnection attempts never reach a socket.
4. **16:02:34, the recovery.** The WLAN came back and the new session
   handshook. MID 0064 with id 0 answered 2644, which is seven ahead of the
   last result delivered, so the client asked for 2638 to 2644 one at a time
   and had all seven back in three hundred milliseconds. Only then did it
   subscribe again with MID 0060. The controller did not push any of those
   seven on the new subscription. Without this step they were gone.
5. **16:02:59, back to normal.** The next tightening, 2645, arrives as a pushed
   MID 0061, and the client acknowledges it like the first one. Nine results
   reached the handler over the run, none of them twice.

An earlier session on the same controller, not the one recorded here, showed
two things the simulator could not. Opening the TCP connection had no timeout.
With the network down, the attempt stayed in `Connecting` for 36 seconds until
the WLAN returned, instead of failing and retrying on the backoff schedule. An
attempt now gives up after `connectTimeout` (10 s by default). The library also
acknowledged a recovered result with a MID 0062, which only a pushed MID 0061
takes. It no longer acknowledges recovered results, which is why no 0062
follows the seven 0065 replies in the trace above.

#### Repeating it with your own controller

Any controller that speaks Open Protocol over TCP will do. Nothing needs to be
configured on it beyond the port the client connects to, because the client
only reads. It subscribes to results and acknowledges them, and never sends a
command that changes the controller's state.

```sh
bun run client -- --host <controller-ip> --port 4545 --device-id tool-1
```

1. **Handshake and baseline.** MID 0001 goes out, 0002 comes back with the
   controller's name. Then MID 0064 with id 0, whose 0065 reply carries the
   controller's latest result. That identifier is the baseline, and results
   older than it count as history rather than news. Then MID 0060, accepted
   with 0005.
2. **A tightening.** Make one. It arrives as MID 0061, the log shows `result
   delivered`, and the MID 0062 acknowledgement goes out after that line, not
   before it.
3. **The outage.** Unplug the controller's network, or switch off its WLAN, and
   make one or more tightenings while it is down. Within `keepAliveInterval +
   responseTimeout` (15 s by default) the log shows the keep-alive going
   unanswered and the state moving to `Reconnecting`.
4. **The recovery.** Put the network back. The client reconnects on its backoff
   schedule, handshakes again, asks MID 0064 for the latest result, sees that
   its identifier jumped past the last one delivered, fetches every missing
   result by identifier, and only then subscribes again. The tightenings made
   during the outage reach the handler, once each. The controller does not
   push them on the new subscription, so without this step they would be lost.
5. **The count.** Ctrl-C prints `delivered`, `duplicates` and the identifiers
   received. `delivered` equals the number of tightenings you made,
   `duplicates` counts whatever the controller resent, and no identifier
   appears twice.

Add `--trace-db <path>` to record your own run into its own file, then open it
with the UI the same way as the recorded one, and compare the two side by
side.

## Technical decisions

Short records of the decisions worth defending.

### ADR 1: Effect only, no framework

**Context.** The original service uses NestJS: decorators for dependency
injection, lifecycle hooks, exceptions for errors.

**Decision.** Effect alone provides dependency injection (`Layer`), lifetimes
(`Scope`), retries (`Schedule`) and error typing.

**Alternatives.** NestJS with Effect inside the services; that keeps two
lifecycle models in one process.

**Trade-off.** No ecosystem of ready-made modules, and a steeper learning
curve for anyone reading the code; in exchange the failure and lifetime model is one thing, not three.

### ADR 2: An abstract transport with an in-memory implementation

**Context.** Connection logic is the risky part and needs to be tested without
sockets and without real time.

**Decision.** `Transport` is a service returning a byte `Duplex`. TCP and
in-memory implementations both satisfy it.

**Alternatives.** Testing against a real localhost socket only; that makes
timing tests slow and flaky.

**Trade-off.** One indirection between the connection and the socket, and the
risk that the in-memory transport is too kind. That is exactly what happened.
A resource leak only appeared over real TCP, which is why a smoke test exists.

### ADR 3: One request in flight at a time

**Context.** Open Protocol replies do not say which request they answer.
Commands get a generic MID 0005 or 0004 that only names the MID it refers to,
and the specification allows only one outstanding message.

**Decision.** A semaphore of one around send-and-await; replies are matched
against the reply the request's definition declares (0005/0004 by the MID they
name, a dedicated reply by its MID and revision). Unmatched messages are
treated as unsolicited traffic.

**Alternatives.** Matching purely on MID with several requests in flight; the
protocol does not give enough information to do this safely.

**Trade-off.** Requests serialise per device. For this traffic pattern, a
handful of commands per session, that costs nothing.

### ADR 4: At-least-once with duplicate detection, not exactly-once

**Context.** The acknowledgement is what makes a result safe on the controller
side, and it can only be sent after the application has taken the result.

**Decision.** Acknowledge after the handler succeeds; remember the last 1,000
identifiers per device to recognise resends.

**Alternatives.** Acknowledging on receipt, which loses results whenever the
handler fails; persisting delivered identifiers, which would mean owning a
database.

**Trade-off.** Exactly-once needs the application's cooperation: an idempotent
handler. The library says so rather than pretending otherwise.

### ADR 5: A handler callback, not a stream of results

**Context.** The moment of the acknowledgement must be tied to the moment the
application takes responsibility.

**Decision.** The application provides `onResult`, and its success is the
acknowledgement signal.

**Alternatives.** Exposing a `Stream<TighteningResult>`; then the library
cannot tell whether a consumer actually handled an element, and the
acknowledgement becomes a guess.

**Trade-off.** Less composable than a stream for consumers who just want to
watch results. Correctness won.

Since then `subscribe` returns a stream for any pushed MID, and it answers the
objection by putting an `ack` on every element. The handler stays for results
because dedup and gap recovery sit between the stream and the application.

### ADR 6: Infinite reconnection with jittered backoff

**Context.** A tool that is unplugged at the end of a shift comes back the next
morning.

**Decision.** Reconnect forever by default: exponential backoff capped at 30
seconds, jittered, reset after a successful session; configurable per device.

**Alternatives.** Giving up after N attempts, which turns a lunch break into a
manual restart.

**Trade-off.** A misconfigured device retries forever, so every attempt is
logged and the state is observable.

## Known limits

- Duplicate detection and the recovery watermark are in memory: a restart
  forgets both, and results acknowledged just before a crash could be delivered
  again. Idempotent handlers cover this.
- The built-in MIDs are defined at revision 1 only. A newer revision arrives as
  `UnknownMessage` until someone defines it.
- One instance per set of devices: the pool owns every device it is given.
- The protocol subset is small on purpose. Adding a MID means writing a
  definition (see [Defining your own MIDs](#defining-your-own-mids)), not
  changing the library.

## NestJS vs Effect

The NestJS version has been in production for a while, so the comparison is not
theoretical. Three incidents from it shaped this rewrite.

**We wrote the same tightening twice.** A network delay pushed our MID 0062
past the controller's one second window, so the controller assumed we never got
the result and sent MID 0061 again. We treated the second copy as a new
tightening. Here, the identifier is the unit of truth: a result is acknowledged
only after the handler has taken it, delivered results are remembered per
device, and a resend is acknowledged again without the handler ever seeing it.
Delivery is also serialised per device, so a resend arriving while the handler
is still working on the original queues behind it instead of racing it.

**One controller cut the service off from every controller.** A controller
sent a MID we did not handle. The error propagated and the service process
died, taking down its connection to every other controller on that instance. Two things prevent that now. An
unsupported MID decodes into `UnknownMessage`, which is logged and dropped,
because a message we do not model is not a reason to break a connection. And
each device runs on its own supervised fiber, so a device that genuinely fails
takes nothing else with it.

**Results produced during an outage were gone.** The link dropped, the
controller kept working, and the tightenings it completed in the meantime never
reached us. Reconnecting was not enough, because a controller gives up on a
result it cannot get acknowledged. The library now asks for them by identifier
with MID 0064, both after reconnecting and whenever an incoming identifier
jumps ahead of the last one delivered.

What Effect made easier:

- **Failures are in the type.** `ConnectionLost`, `HandshakeRejected`,
  `RequestTimeout` and `CommandRejected` are in the signature, so the compiler
  points at the case I have not handled. The original relied on exceptions and
  on remembering, which is how an unhandled MID became an outage.
- **Time is a value.** Keep-alive, silent-link detection and backoff timing are
  tested with `TestClock` in milliseconds of real time. In the original those
  paths were tested by waiting, or not at all.
- **Lifetimes are explicit.** A connection attempt is a `Scope`; when it dies,
  the socket and its fibers go with it.
- **Retry is declarative.** `Schedule.exponential |> jittered |> modifyDelay`
  replaces a hand-written loop with its own timer bugs.

What it costs:

- **Harder to pick up.** A reader new to Effect has the most to learn exactly
  where the power is: `Scope`, fiber supervision, and interruption.
- **Verbosity.** Wiring a service through layers is more ceremony than a
  decorator.
- **Team familiarity.** Any TypeScript developer can read the NestJS version.
  This one needs somebody who knows Effect.
- **Ecosystem age.** The socket and CLI modules live under `unstable/` in
  Effect v4, so the version is pinned exactly.

I would run this in production as it stands. The three incidents above are
structural in the old design and structural in this one, in opposite
directions: the cases that used to lose or duplicate traceability data are the
cases this version is built around. Asking readers to know Effect is a real
cost, and for this service it is worth paying, which is not the same as saying every service
should be written this way.

## Use of AI

I built this project with Claude (Anthropic) driving most of the keyboard, so
here is what that actually means.

The project, the domain knowledge and the decisions are mine. So is every ADR
above. The answers that shaped the design came from having run the NestJS
version in production: that an unacknowledged result is lost for good, that the
controller queues results until it gets an acknowledgement, and the timeouts
the controllers really use.

I wrote the design document myself, from what I had built with NestJS, before
any implementation started. The code and the tests are AI-written from
that design and my suggestions along the way. I did not write this by hand
and then present it as such.

Two things were checked rather than recalled. The protocol details come from
the published specification, not from memory, which is how the header layout,
the 15 second idle timeout and the resend behaviour ended up correct. The
Effect APIs come from the installed source, which mattered because the socket
and CLI modules moved in v4. The chaos test then found three defects that
neither of us had spotted by reading.

## What I learned

The interesting part was not the protocol, it was what each layer of testing
caught that the previous one could not.

Unit tests with `TestClock` found the ordinary bugs. The real socket smoke test
found one they structurally could not: Node keeps a listening server alive
until its accepted sockets are gone, which the in-memory transport has no
reason to imitate. The chaos test, running the whole system under seeded
faults, found three more: a socket that died during the handshake was noticed
only when a request timed out, the recovery watermark stepped over gaps instead
of advancing contiguously, and a result the controller abandoned on a healthy
link was never fetched.

Then I ran the same scenario across fifty seeds instead of two, and it found
five more. Every one of them was a lost tightening result. A recovery request
that timed out was filed as "the controller does not have it" and never
retried. A controller that was empty when we first asked wrote off the first
result it ever produced. Recovery only ever ran when something arrived, so a
line that went quiet kept its gap forever. Two of those five were in code I had
written in response to the earlier findings.

That is the lesson worth keeping. Every one of these bugs was silent: no
exception, no failed test, no log line, just a smaller number at the end of a
run. This class of defect does not yield to reading the code more carefully,
because the code looks correct and is correct for the path you are imagining.
It yields to running the thing a few hundred times with different randomness
and checking an invariant that cannot be argued with.

What I would explore next: Effect's Cluster. Today each set of controllers
needs its own instance of the service, and when that instance goes down the
connection to all of them goes with it. With Cluster each controller could be
an entity that any instance can own, moving to another instance when its owner
fails. Then testing other controller models and longer outages than the one
tried on the Nexo. Then a wider MID
subset driven by what integrations actually ask for, and metrics and tracing,
since the spans are already in place.
