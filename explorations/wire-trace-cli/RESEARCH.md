# Research

<!--
Stage 1. Ground the capture in reality. Two halves: what exists outside the
repo (cited), and what exists inside it (so we compose bricks instead of
rebuilding them). Date sections; research goes stale.
-->

## External Landscape

### 2026-09-18, prior art for the product shape

Atlas Copco's own **Open Protocol Tester** is the closest thing to what this
packet wants, and it comes from the vendor of the protocol itself. It is a PC
utility that builds, sends, receives and analyses Open Protocol MID messages in
real time, subscribes to tightening results, and keeps trace sessions with
timestamps, filters, search and log export
([open-protocol-tester.software.informer.com](https://open-protocol-tester.software.informer.com/)).
Two things follow from that. A timestamped, exportable trace is what a tool in
this space is expected to produce. And the vendor tool is a single GUI client,
so a paired controller and client CLI, both tracing, is not something it
offers.

### 2026-09-18, simulating latency, three families

1. **In process, inside our own code.** Nothing to install, runs on any OS,
   seedable and therefore replayable. The repo already does exactly this for
   the controller side, as the inventory below shows.
2. **Out of process, a TCP proxy such as Toxiproxy.** A transparent TCP proxy
   with an HTTP API. You create a proxy that listens on one port and forwards
   to the real upstream, then add "toxics": latency with a fixed delay plus
   jitter, bandwidth, timeout, slow close, connection reset
   ([Shopify/toxiproxy](https://github.com/Shopify/toxiproxy),
   [QASkills guide](https://qaskills.sh/blog/toxiproxy-fault-injection-testing-guide-2026)).
   Its stated advantage is that real networking and pooling code runs under
   failure, because a real proxy corrupts a real stream
   ([Grokipedia](https://grokipedia.com/page/Toxiproxy)). It costs an extra
   binary and an extra hop to configure, and its delay cannot be reproduced
   from our seed.
3. **OS level shaping with `tc netem`.** A kernel qdisc that adds delay,
   jitter, loss and reordering. It works on the loopback interface
   (`tc qdisc add dev lo root netem delay 600ms`), which is what a localhost
   run would need
   ([tc-netem(8)](https://man7.org/linux/man-pages/man8/tc-netem.8.html),
   [oneuptime](https://oneuptime.com/blog/post/2026-03-20-simulate-network-latency-tc-netem/view)).
   Two limits matter here. It needs `NET_ADMIN`, which in containers must be
   added at creation time, otherwise `tc` fails with `RTNETLINK answers:
   Operation not permitted`. And it shapes egress only, so latency in both
   directions means shaping both ends
   ([Red Hat Developer](https://developers.redhat.com/articles/2025/05/26/how-simulate-network-latency-local-containers)).
   Linux only, root only, and invisible to the trace we are about to print.

What that means for this packet. Option 1 is the only family that runs
everywhere, seeds, and shows up in our own log. Options 2 and 3 are what a
reviewer would reach for to cross-check that the library survives latency it
did not generate itself.

### 2026-09-18, CLI framework

Effect v4 ships the CLI in core as `effect/unstable/cli`, which holds
`Command`, `Flag`, `Argument`, `Primitive` and `Prompt`, and it replaces the v3
`@effect/cli` package. `Flag` and `Argument` share a `Param` type, so
`withDefault`, `optional`, `map` and `withSchema` work on either. `GlobalFlag`
supplies the built-in `--help`, `--version` and `--completions`, plus custom
global settings such as `--log-level`. Flags must come before arguments
([Effect Solutions, CLI](https://www.effect.solutions/cli),
[effect-smol ai-docs 70_cli](https://github.com/Effect-TS/effect-smol/blob/main/ai-docs/src/70_cli/10_basics.ts)).
This is what `demo/chaos.ts` already imports, so no dependency decision is
open.

## In-Repo Capability Inventory

### 2026-09-18, already built, compose these

| Need | Existing brick | Where |
| --- | --- | --- |
| CLI parsing, help, exit codes | `Command.make`, `Flag.Int`, `Flag.Finite`, `Command.run` from `effect/unstable/cli` | `demo/chaos.ts:16`, `demo/chaos.ts:150-207` |
| Runnable script wiring | `"demo": "bun run demo/chaos.ts"` | `package.json:25` |
| Node runtime and services for a CLI | `NodeRuntime.runMain`, `NodeServices.layer` | `demo/chaos.ts:204-207` |
| A controller listening on a real TCP port | `makeTcp`, which wraps `NodeSocketServer.make` and adapts sockets to `ServerSide` | `simulator/ControllerSimulator.ts` |
| What a controller answers | `replyTo`, `observe`, `resultFor`, `ControllerIdentity` | `simulator/ControllerBehaviour.ts` |
| Controller session lifecycle: accept, serve, push, await MID 0062, resend, abandon | `makeWith` | `simulator/ControllerSimulator.ts` |
| Seeded misbehaviour including reply latency | `Faults.next`, `FaultKind` covering `dropConnection`, `goSilent`, `delayReply`, `splitFrame`, `coalesceFrames`, `rejectCommand`, `refuseConnections`; `FaultConfig.maxDelay` defaults to 8s, `maxOutage` to 5s | `simulator/Faults.ts` |
| Where faults are applied to outgoing frames | `sendWithFaults` | `simulator/FaultyWire.ts` |
| A supervised client that reconnects, subscribes and recovers gaps | `makeDeviceConnection`, `DeviceConnection.layer` | `src/connection/DeviceConnection.ts` |
| Real sockets for the client | `TcpTransport.layer` | `src/transport/TcpTransport.ts` |
| Many clients at once | `DevicePool.layer` | `src/pool/DevicePool.ts` |
| Observable connection state | `connection.state`, a `SubscriptionRef<ConnectionState>` | `src/connection/DeviceConnection.ts`, `src/connection/ConnectionState.ts` |
| Result handler hook, what the client prints per result | `DeviceConfig.onResult` | `src/connection/DeviceSettings.ts` |
| Exact bytes to message, both directions | `encodeMessage`, `decodeMessage` | `src/protocol/Messages.ts` |
| Frame boundaries out of a byte stream | `frames`, `step`, using a latin1 `TextDecoder` | `src/protocol/Framer.ts` |
| The terminator a raw dump must make visible | `terminator`, which is NUL, and `headerLength` of 20 | `src/protocol/Header.ts` |
| Structured logging with context | `Effect.logInfo` and `Effect.logDebug` with `Effect.annotateLogs` | throughout, for instance `src/results/ResultDelivery.ts`, `src/connection/DeviceConnection.ts` |
| Proof both sides already run over a socket together | localhost smoke test wiring `makeTcp`, `makeDeviceConnection` and `TcpTransport.layer` | `test/integration/Tcp.test.ts` |

### 2026-09-18, the seam a wire trace attaches to

`Duplex` is the whole byte-level boundary. It is `incoming:
Stream<Uint8Array, ConnectionLost>` plus `send: (bytes) => Effect<void,
ConnectionLost>` (`src/transport/Transport.ts`). Every byte either side sends
or receives passes through it, on the client through `Transport.connect` and on
the controller through `ServerSide`
(`src/transport/InMemoryTransport.ts`). A decorating `Duplex` that logs and
forwards would therefore trace both CLIs without touching one line of
connection, codec or simulator logic. Being the same seam, it is also where
symmetric latency can be injected.

### 2026-09-18, gaps, NOT FOUND in `src/**`, `simulator/**`, `demo/**`

1. **Raw wire logging.** NOT FOUND. Nothing logs the frame string or its bytes.
   The closest is `Effect.logDebug("acknowledged a result")` with annotated ids
   (`src/connection/DeviceConnection.ts`). There is no trace file, no
   timestamped direction-prefixed output, and no escaping helper for NUL and
   other control characters. `padText` and `padNumber`
   (`src/protocol/Ascii.ts`) render fields, not dumps.
2. **Client-side or link latency.** NOT FOUND. `Faults.delayReply` is applied
   only in `simulator/FaultyWire.ts`, which means only frames the controller
   writes are ever slowed. Nothing delays client-to-controller traffic, and
   `TcpTransport` has no delay hook.
3. **A controller-only, long-running command.** NOT FOUND. `makeTcp` exists,
   but only `test/integration/Tcp.test.ts` calls it, inside a scoped test.
   `demo/chaos.ts` runs both sides in one process over the in-memory transport
   (`layerComplete`), so no process today serves a port and stays up.
4. **A client-only command.** NOT FOUND, for the same reason.
5. **`refuseConnections` over TCP.** A known no-op. `makeTcp` passes
   `() => Effect.void` as `refuse`, with a comment explaining that a listening
   TCP socket cannot stop accepting without being torn down
   (`simulator/ControllerSimulator.ts`). A TCP controller CLI inherits this
   hole.

## Constraints Discovered

- `makeWith` already takes `accept` and `refuse` as parameters, so a TCP
  controller command needs no simulator surgery, only a caller
  (`simulator/ControllerSimulator.ts`).
- The simulator stamps every result with `DeviceId "simulator"`
  (`simulator/ControllerBehaviour.ts`), while the client stamps decoded results
  with its own configured `DeviceId`. A trace showing both sides will show two
  different device ids for the same tightening. That is cosmetic, and someone
  will ask about it.
- Frames arrive split or coalesced by design, through `splitFrame`,
  `coalesceFrames` and plain TCP, so a byte-chunk trace and a frame trace are
  different artifacts. Which one "the whole raw string" means is an align
  question.
- Every random decision is seeded through `Random.withSeed` (`demo/chaos.ts`),
  and the repo treats exact replay as a property worth keeping.
- Anything printed raw contains a NUL terminator and fixed-width padding, so
  the trace format has to make both visible without breaking a terminal.
