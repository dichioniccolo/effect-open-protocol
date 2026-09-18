# Brief

<!--
Stage 3. The shaped pitch (Shape Up anatomy). Fat-marker fidelity: concrete
enough to evaluate and decompose, rough enough to leave design latitude to
the implementing goal packets. The exploration is shaped when the human says
this file matches the picture in their head.
-->

## Problem

The library works, and there is no way to watch it work.

The repo runs itself two ways today. `bun run demo` runs N controllers and a
pool in one process over the in-memory transport and prints a pass/fail
invariant summary. It proves the claim and shows nothing of the protocol.
`test/integration/Tcp.test.ts` does use a real socket, but it lives for a
second and asserts instead of narrating. Neither leaves a process listening on
a port. Neither logs a single byte of what crossed the wire (`RESEARCH.md`,
Gaps 1 to 4). Neither lets you hold a handshake still and look at it.

That gap hurts in three ways, and all three are concrete. Debugging against a
real controller has no reference trace to diff against, because "here is what a
healthy MID 0002 looks like" does not exist anywhere in the repo. Onboarding
anyone to Open Protocol means reading the specification instead of watching
twenty bytes go past. And the client-to-controller direction has never run
under latency at all: `Faults.delayReply` lives in `simulator/FaultyWire.ts`
and slows only frames the controller writes, so the client's send path,
request/reply timeouts and keep-alive accounting have never met a slow link.

Vendor tooling says the shape is right. Atlas Copco's own Open Protocol Tester
is built around timestamped, filterable, exportable MID trace sessions
(`RESEARCH.md`, External Landscape). It is a single GUI client, though. Two
CLIs, one being the controller and one being the client, both narrating, is the
version this repo can have.

## Appetite

Small batch, one focused session.

That budget holds only because most of this composes bricks that already exist.
`makeTcp` serves a real port. `makeDeviceConnection` with `TcpTransport.layer`
is the client. `Faults` is the misbehaviour catalogue. `demo/chaos.ts` is the
`effect/unstable/cli` pattern to copy. The new code is two `Duplex` decorators
and one listener rebind.

The budget constrains the design in four places. One device, not a pool. No
trace viewer, no filtering, no replay tooling, just a log line and a JSONL file
with `grep` as the filter. No new dependency, since the CLI framework already
ships in core. And if the listener rebind, the one real unknown, starts eating
the session, that is the piece that gets cut back to the documented no-op. Not
the trace.

## Solution sketch

Two commands, one seam.

```text
  cli/controller.ts                            cli/client.ts
  bun run controller --port 4545               bun run client --port 4545
        │                                            │
   makeTcp(...)  ← simulator, faults, results   makeDeviceConnection(...)
        │                                            │
   ServerSide (Duplex)                          Transport.connect → Duplex
        │                                            │
   ┌────┴─────────────────────┐              ┌───────┴──────────────────┐
   │  traced( latency( … ) )  │              │  traced( latency( … ) )  │
   └────┬─────────────────────┘              └───────┬──────────────────┘
        │                                            │
        └──────────────── TCP :4545 ─────────────────┘
```

**The seam.** `Duplex` (`src/transport/Transport.ts`) is `incoming:
Stream<Uint8Array>` plus `send: (bytes) => Effect<void>`. Every byte either
side moves crosses it. Two decorators live in `src/transport/`, shipped, and
compose in either order.

**Tracing decorator.** It logs what it sees, then forwards the bytes untouched.
It emits the chunk exactly as written or read, and the reassembled frame. The
framer is already pure and reusable for that (`step` and `frames`,
`src/protocol/Framer.ts`). Raw bytes get escaped, so a NUL terminator and
trailing padding stay visible without wrecking a terminal.

**Latency decorator.** It draws a delay from `--latency` plus or minus
`--jitter` on the seeded `Random`, then sleeps before forwarding. Each end
delays its own writes, so a round trip is the sum of two one-way delays and
neither side coordinates with the other.

**The trace.** One line per event on stdout via the Effect logger, plus
`--trace-file trace.jsonl` for diffing two seeded runs.

```text
10:14:16.312 INFO  wire  dir=send  bytes=20  mid=0001
  raw="00200001001         \0"
10:14:16.498 INFO  wire  dir=recv  bytes=31  mid=0002
  raw="00310002001         0100102010..\0"
```

**`bun run controller`.** It binds a port, behaves like a controller, and
misbehaves on request. Flags: `--port`, `--seed`, `--latency`, `--jitter`,
`--fault-rate` for the whole `FaultKind` catalogue, `--result-interval`,
`--controller-name`, `--trace-file`. Pressing Enter produces one result
immediately, which is how you make a result appear during an outage and then
watch gap recovery fetch it. On Ctrl-C it prints results generated and results
abandoned.

**`bun run client`.** It connects, handshakes, subscribes, and prints every
result it is handed. Flags: `--host`, `--port`, `--device-id`, `--seed`,
`--latency`, `--jitter`, `--trace-file`. It logs connection state changes as
they happen, so backoff and re-handshake are visible. On Ctrl-C it prints
delivered, duplicates and final state.

**The one behaviour change in existing code.** `makeTcp` currently passes
`() => Effect.void` for `refuse`, so `refuseConnections` does nothing over TCP
(`simulator/ControllerSimulator.ts`). The controller command instead tears the
listener down for the outage window and rebinds after it, dropping open
sessions with it. That is a reboot, not a polite refusal. The client then sees
a real `ECONNREFUSED` and runs its actual reconnect, backoff, re-handshake and
gap-recovery path.

**The demo it produces.** Start the controller. Start the client. Watch the
handshake. Raise `--latency`. Raise `--fault-rate` until the link starts
breaking. Hit Enter while it is down. Watch MID 0064 and 0065 fetch the result
that was produced while nobody was listening. Two seeded runs with
`--trace-file` diff clean.

## Rabbit holes

**The listener rebind is the one real unknown.** It makes the listener's
lifecycle fault-driven, touching `makeTcp`'s scope and finalizers. `makeTcp`
already has delicate teardown, because Node keeps a listening server alive
until its sockets are gone, which is why the `openSockets` deferred list is
there. Rebinding to the same port also races `TIME_WAIT`. Patch: this is the
designated cut. If it fights back, the outage stays a documented no-op over TCP
and the rest of the packet ships.

**Chunk-versus-frame double logging can drown the signal.** A split frame
produces three chunk lines and one frame line. A coalesced read produces one
chunk line and two frame lines. Patch: tag every line with its kind and put the
two kinds on separate log levels, so one `--log-level` flag chooses between the
protocol conversation and everything that crossed the socket.

**Escaping is a correctness problem, not cosmetics.** Frames are latin1, end in
NUL, and are space-padded to fixed widths. A naive dump hides trailing padding
and can corrupt a terminal. Patch: one escaping helper, and a round-trip test
proving that unescaping a traced frame reproduces the exact bytes.

**Stdin handling for the Enter trigger.** Raw-mode stdin plus Ctrl-C plus
Effect's interruption is a place to lose an afternoon. Patch: read lines rather
than keypresses, and let `NodeRuntime.runMain` keep owning SIGINT.

**Two device ids for one tightening.** The simulator stamps results with
`DeviceId "simulator"`, and the client stamps them with its own `--device-id`.
A side-by-side trace shows both. Patch: label the columns in the README rather
than change either side.

**Shipping the decorators grows the public surface.** They land in
`src/transport/` and therefore in `dist`, under the repo's JSDoc rubric. Patch:
accepted cost, budgeted. Two modules, compilable examples, and a flat re-export
from `src/index.ts` like everything else.

## No-gos

- No pool, no multi-device. One client, one controller. The protocol allows one
  client per controller and the library already models the refusal
  (`HandshakeRejected` code 96). Multi-device supervision is `demo/chaos.ts`'s
  job.
- No `--duration`, no scripted-run mode. Runs end on Ctrl-C. A scripted run
  uses an external timeout.
- No trace viewer, no filtering, no replay-from-file. The trace is a log line
  and a JSONL file. `grep`, `jq` and `diff` are the tooling.
- No new dependency. Not Toxiproxy, not `tc netem`. Both stay in `RESEARCH.md`
  as the out-of-process cross-check a reviewer may reach for, and neither
  becomes a requirement to run these commands.
- No replacement of `demo/chaos.ts`. It keeps proving the invariant over the
  in-memory transport. These commands show the protocol, they do not assert.
- No `--fault-kinds` selection. `FaultConfig.kinds` supports it and it may
  return later. `--fault-rate` alone keeps the flag surface small.
- No changes to the protocol codec, the connection state machine, or delivery
  semantics. The only existing behaviour this packet changes is `makeTcp`'s
  refuse path.
