# Decisions

<!--
Stage 2. The grilling log. One entry per resolved branch-closing question,
newest last. Unresolved questions live in ops/manifest.json `openQuestions`
until they land here. Deferred questions get an entry too, marked DEFERRED
with the reason.
-->

## 2026-09-18, latency model

**Question:** How should the two CLIs simulate network latency?

**Answer:** In process, seeded, both directions. A decorating `Duplex` at the
`src/transport/Transport.ts` seam delays reads and writes, driven by the same
`--seed` discipline the rest of the repo uses.

**Rationale:** Recommended and accepted. Only this option covers the
client-to-controller direction, which has no latency at all today.
`Faults.delayReply` is applied solely in `simulator/FaultyWire.ts`, so only
controller writes are ever slowed (`RESEARCH.md`, Gaps 2). It runs on any OS,
replays from a seed, and the injected delay shows up in the same trace the CLIs
print.

Rejected, controller-only reply delay, which is the status quo. Zero new code,
but it leaves the client's own send path, request/reply timeouts and keep-alive
accounting untested under latency.

Rejected, an external proxy such as Toxiproxy. It exercises a real stream and
is the honest cross-check, but it adds a binary to install, cannot be
reproduced from our seed, and stays invisible to our own trace. `RESEARCH.md`
keeps it as the out-of-process cross-check a reviewer can reach for.

## 2026-09-18, trace granularity

**Question:** What counts as "the whole raw string" in the trace?

**Answer:** Both, tagged. Log the byte chunk exactly as it crossed the socket
and the reassembled frame.

**Rationale:** Recommended and accepted. Chunks and frames are different
artifacts in this repo, and the fault catalogue proves it. `splitFrame` and
`coalesceFrames` (`simulator/Faults.ts`) exist to break the correspondence, and
plain TCP breaks it anyway. Logging only frames would make a message split across
three reads indistinguishable from one that arrived whole. Logging only chunks
would scatter a single message across several lines and put two messages on one
coalesced read. Both, tagged, keeps each question answerable.

Rejected, frame only. Cleanest to read, hides fragmentation.

Rejected, chunk only. Truest to the wire, unreadable as protocol.

## 2026-09-18, trace output and escaping

**Question:** Where does the trace go, and how are NUL and padding shown?

**Answer:** stdout through the Effect logger, one annotated line per event with
control characters escaped, plus an optional `--trace-file` writing raw JSONL.
Agreed shape:

```text
10:14:16.312 INFO  wire  dir=send  bytes=20  mid=0001
  raw="00200001001         \0"
10:14:16.498 INFO  wire  dir=recv  bytes=31  mid=0002
  raw="00310002001         0100102010..\0"
```

```json
{"t":"2026-09-18T10:14:16.312Z","dir":"send","raw":"0020..."}
```

**Rationale:** Recommended and accepted. Live stdout is what makes a handshake
watchable, which is the point of the tool. The optional file is what makes two
runs diffable, which is the point of seeding them. Escaping is not optional.
Every frame ends in NUL (`terminator`, `src/protocol/Header.ts`) and fields are
space-padded (`padText` and `padNumber`, `src/protocol/Ascii.ts`), so an
unescaped dump would corrupt a terminal and hide trailing padding.

Rejected, stdout only. No diffing without a `tee`.

Rejected, a JSONL file with only a summary on stdout. Better for long
unattended runs, worse for watching a session come up, which is the primary
use.

## 2026-09-18, client command scope

**Question:** How many devices should the client command drive?

**Answer:** One device against one controller.

**Rationale:** Recommended and accepted, and the repo answers it. Open Protocol
allows a single client per controller, and the library already models the
refusal. `HandshakeRejected` carries code 96, "another client already holds the
connection" (`src/connection/ConnectionError.ts`). Pointing a pool at one
controller would mostly produce handshake rejections, which tests the rejection
path and little else.

Rejected, N devices across N ports. It would exercise `DevicePool` and
per-device isolation, but it needs a port range on the controller command and
makes the trace much busier. `demo/chaos.ts` already covers multi-device
supervision over the in-memory transport.

Rejected, single now with a `--devices` flag later. Same outcome as the
accepted answer, but it leaves a gate open in `MAP.md` for something the
protocol does not allow against a single controller.

## 2026-09-18, where the decorators live

**Question:** Where do the tracing and latency `Duplex` decorators live?

**Answer:** In `src/transport/`, shipped in the public API.

**Rationale:** Recommended and accepted. Both are `Transport` and `Duplex`
decorators, and `Duplex` is the byte-level seam every message already crosses
(`src/transport/Transport.ts`). A wire tracer helps anyone debugging an actual
controller, not only the test tooling. `src/index.ts` re-exports every module
flat, so they join the surface by convention. Two costs come with that. The
JSDoc rubric with `@since` and `@category` applies, and `dist` grows, because
`tsdown` builds `src/index.ts` and `package.json` publishes `files: ["dist"]`.

Rejected, an unshipped `cli/` or `demo/` home. It keeps the published surface
untouched, but then a library user debugging a live controller cannot reuse the
tracer.

Rejected, splitting them so the tracer ships and the latency does not.
Defensible, but it puts two halves of one decorator pattern in two places.

## 2026-09-18, latency knobs

**Question:** What latency knobs do the commands expose?

**Answer:** `--latency <ms>` and `--jitter <ms>`, applied per direction by each
command to its own writes, with the delay drawn from the seeded `Random`.

**Rationale:** Recommended and accepted. It has the same shape as Toxiproxy's
latency toxic, delay plus jitter (`RESEARCH.md`). Each end delays its own
writes, so one-way latency composes into a round trip without either side
coordinating, and jitter is what reorders traffic and surfaces timeout edges.
Seeded, so a run replays.

Rejected, a fixed `--latency` alone. Predictable, but it never reorders
anything.

Rejected, reusing `--fault-rate` and `Faults.maxDelay`. That makes latency an
occasional event rather than a baseline condition of the link.

## 2026-09-18, the TCP refuse-connections hole

**Question:** `refuseConnections` is a no-op over TCP. Fix it in this packet?

**Answer:** Fix it, the invasive way. The controller tears down its listener
for the outage window and rebinds afterwards. This overrides the
recommendation, which was to document and accept.

**Rationale:** The port stops listening, so the client sees a real
`ECONNREFUSED` exactly as it would from a rebooting controller, instead of a
simulated refusal. That is the behaviour the library's reconnect and backoff
path is meant to survive, and nothing else reproduces it faithfully.

The brief names the accepted cost as a rabbit hole. The listener's lifecycle
becomes fault-driven, which is the most invasive of the three options and
touches `makeTcp` (`simulator/ControllerSimulator.ts`), where `refuse` is
currently `() => Effect.void`.

Rejected, document and accept. Cheapest, and killing then restarting the
command reproduces the outage by hand, but it leaves the known hole open.

Rejected, gating accepts while the listener stays up. The client would see an
immediate close rather than a refusal, which is a different failure.

## 2026-09-18, repo wiring

**Question:** How are the two commands wired into the repo?

**Answer:** A new `cli/` directory with two entrypoints, `cli/controller.ts`
and `cli/client.ts`, plus two `bun run` scripts beside the existing `demo`.

**Rationale:** Recommended and accepted. The capture asked for two distinct
commands, and `demo/chaos.ts` keeps its own job, the seeded invariant check
over the in-memory transport. A separate directory keeps "watch the protocol"
apart from "prove no result is lost".

Rejected, adding both to `demo/`. No new top-level directory, but it conflates
two different purposes under a name the README already defines.

Rejected, one command with subcommands. `effect/unstable/cli` supports it, but
the capture asked for two distinct commands.

## 2026-09-18, outage scope

**Question:** When the controller rebinds its listener, what happens to the
session already open?

**Answer:** Drop everything. A reboot takes its sessions with it.

**Rationale:** Recommended and accepted. It matches what the fault is named
after and exercises the library's full recovery path: `ConnectionLost`,
backoff, re-handshake, re-subscribe, and gap recovery for results produced
during the outage (`src/connection/DeviceConnection.ts`,
`src/connection/GapRecovery.ts`).

Rejected, keeping established sessions and refusing only new connections. It
would match `InMemoryTransport.refuse` semantics exactly, but it tests less.

Rejected, making it a flag. One more knob and one more branch for a behaviour
with a clear default.

## 2026-09-18, fault catalogue exposure

**Question:** Does the controller command expose the rest of the fault
catalogue, or only latency?

**Answer:** The full catalogue via `--fault-rate`, with latency on its own
separate flags.

**Rationale:** Recommended and accepted. `Faults.FaultKind` already carries
`dropConnection`, `goSilent`, `delayReply`, `splitFrame`, `coalesceFrames`,
`rejectCommand` and `refuseConnections` (`simulator/Faults.ts`), so exposing
them costs one flag and serves the capture's "test all library behavior".
Latency stays a baseline condition of the link rather than an occasional fault.

Rejected, latency only. Quieter, but it leaves the existing catalogue reachable
only through `bun run demo`.

Rejected, adding `--fault-kinds` selection. `FaultConfig.kinds` supports it and
it may return later. Left out now to keep the flag surface small.

## 2026-09-18, result production

**Question:** How does the controller produce tightening results?

**Answer:** On a timer via `--result-interval`, plus pressing Enter to produce
one immediately.

**Rationale:** Recommended and accepted. The timer path already exists
(`SimulatorOptions.resultInterval`, `simulator/ControllerSimulator.ts`) and
gives a steady stream to watch. The keypress lets a result appear at an exact
moment, during an outage for instance, which is how gap recovery gets
demonstrated by hand instead of waited for.

Rejected, timer only. Non-interactive and script-friendly, but reproducing a
gap means waiting for the timer to fire at the right moment.

Rejected, on demand only. No sustained load to watch.

## 2026-09-18, run lifetime and exit summary

**Question:** What ends a run, and what is printed when it does?

**Answer:** Run until Ctrl-C, with no `--duration` flag. Both commands print a
summary on the way out. The controller prints results generated and abandoned.
The client prints delivered, duplicates and its final connection state.

**Rationale:** The lifetime answer overrides the recommendation, which paired
Ctrl-C with an optional `--duration`. The simplest lifecycle leaves nothing to
misread, and a scripted run can use an external timeout. The summary was
recommended and accepted. Ctrl-C runs scope finalizers anyway under
`NodeRuntime.runMain`, so a closing block costs almost nothing and turns an
ad-hoc watch into something quotable.

Rejected, no summary at all on the grounds that the trace is the output. It
avoids a second source of truth, but it makes the client's `delivered` and
`duplicates` counters, which are the library's actual claim, something you have
to count by hand.

Rejected, a client-only summary. The controller's generated and abandoned
counts are what the client's numbers get compared against.

## 2026-09-18, appetite

**Question:** What is the appetite for this work?

**Answer:** Small batch, one focused session.

**Rationale:** Recommended and accepted. Most of both commands composes bricks
that already exist: `makeTcp`, `makeDeviceConnection`, `TcpTransport.layer`,
`Faults`, and the `demo/chaos.ts` CLI pattern. The new code is two `Duplex`
decorators and the listener rebind. The rebind is the one item that could eat
the budget, and the brief names it as a rabbit hole.
