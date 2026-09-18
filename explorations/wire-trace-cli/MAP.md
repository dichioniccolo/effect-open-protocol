# Map

<!--
Stage 4. Decomposition into candidate goal packets. This is the graduation
surface: the definition-of-ready in explorations/README.md is checked against
this file. Every major component cites an existing repo capability or is
explicitly marked NET-NEW.
-->

One goal packet. The appetite is a small batch, one focused session
(`DECISIONS.md`, appetite), and the work is one dependency chain with a single
acceptance story: start two commands, watch the protocol. Splitting it into
three packets would cost more ceremony than the work it routes. The six phases
below become phases inside that goal's `PLAN.md`, and the listener rebind
becomes a stop condition rather than a packet boundary.

## Candidate Goal Packets

| Slug | Mission | Depends on | Capabilities cited |
| --- | --- | --- | --- |
| `wire-trace-cli` | Ship two runnable commands that make Open Protocol observable by hand: `bun run controller` serves a simulated controller on a port, `bun run client` connects and receives results, both printing every raw frame and byte chunk they send and receive, both able to inject seeded latency. Shipped as a mergeable PR. | none | Reuse: `demo/chaos.ts` (CLI pattern, `Command`/`Flag`/`Command.run`, `NodeRuntime.runMain`, `NodeServices.layer`), `package.json` `scripts`, `simulator/ControllerSimulator.ts` (`makeTcp`, `makeWith`), `simulator/ControllerBehaviour.ts`, `simulator/SessionState.ts`, `simulator/FaultyWire.ts`, `simulator/Faults.ts` (`FaultKind`, `FaultConfig`, `next`), `src/connection/DeviceConnection.ts` (`makeDeviceConnection`), `src/connection/DeviceSettings.ts` (`DeviceConfig.onResult`), `src/connection/ConnectionState.ts`, `src/transport/TcpTransport.ts`, `src/transport/Transport.ts` (`Duplex`, the seam), `src/protocol/Framer.ts` (`step`, `frames`), `src/protocol/Messages.ts` (`decodeMessage`), `src/protocol/Header.ts` (`terminator`, `headerLength`), `test/integration/Tcp.test.ts` (reference wiring). NET-NEW: tracing `Duplex` decorator, latency `Duplex` decorator, control-character escaping helper, `cli/controller.ts`, `cli/client.ts`, TCP listener teardown and rebind for `refuseConnections`. |

## Sequencing

Inside the goal, in this order, each phase closing with `bunx tsc --noEmit` and
`bun run test` green.

1. **Tracing decorator.** A `Duplex` that logs and forwards, in
   `src/transport/`, with the escaping helper beside it. Cites `Duplex`
   (`src/transport/Transport.ts`) and the pure framer (`src/protocol/Framer.ts`)
   for frame reassembly. Provable on its own: a round-trip property test that
   unescaping a traced frame reproduces the exact bytes.
2. **Two entrypoints.** `cli/controller.ts` over `makeTcp`, `cli/client.ts` over
   `makeDeviceConnection` and `TcpTransport.layer`, both stacking the tracer,
   plus the two `bun run` scripts. This phase is the first vertical slice.
3. **Latency decorator.** Seeded delay drawn from `--latency` and `--jitter`,
   wired into both commands, plus `--trace-file` for JSONL output. Cites
   `Faults.pickDuration` for the seeded-duration pattern and `Random.withSeed`
   (`demo/chaos.ts`).
4. **Controller knobs.** `--fault-rate` over the whole `FaultKind` catalogue,
   `--result-interval`, Enter to produce one result, Ctrl-C summaries on both
   commands. Mostly passing `SimulatorOptions` through; the Enter trigger and
   the summaries are the new parts.
5. **Listener rebind.** `refuseConnections` stops being a no-op over TCP: the
   controller tears its listener down for the outage window, drops open
   sessions, and rebinds. Touches `makeTcp`'s scope and finalizers.
6. **Docs and close.** README section, JSDoc rubric pass on the two shipped
   modules (`.patterns/jsdoc-documentation.md`), full verification run, PR to
   mergeable.

Order follows the dependency chain. The tracer has no I/O and no CLI. The
entrypoints need the tracer to be worth running. Latency and knobs decorate
entrypoints that already work. The rebind changes existing simulator behaviour
and therefore goes last, where dropping it costs nothing else.

Optional cuts if the appetite runs out, in this order: the listener rebind
(phase 5, the designated cut named in `BRIEF.md`), then `--trace-file`, then
the Enter trigger.

## First Vertical Slice

Phase 2 lands when two terminals tell the same story.

Start `bun run controller --port 4545`. Start `bun run client --port 4545`. The
client reaches `Ready`, and both terminals print the same four frames from
opposite directions: MID 0001 out and 0002 back, then 0060 out and 0005 back.
Every line carries its direction, its byte count, its MID, and the raw string
with the NUL terminator and the field padding visible.

Verified by the existing localhost pattern in `test/integration/Tcp.test.ts`
extended with a trace assertion: connect over a real socket, capture the
traced lines, and assert the handshake frames appear on both sides in order and
that unescaping each one reproduces the bytes the socket carried.

## Open Risks Inherited From The Brief

- Listener rebind makes `makeTcp`'s lifecycle fault-driven, races `TIME_WAIT`,
  and fights the existing `openSockets` teardown. It is the designated cut.
- Chunk and frame lines together can drown the signal; they need separate log
  levels so `--log-level` picks the view.
- Escaping is correctness, not cosmetics: latin1 bytes, a NUL terminator, and
  fixed-width padding. It needs a round-trip test, not an eyeball.
- Stdin for the Enter trigger has to coexist with Ctrl-C and Effect
  interruption. Read lines, and let `NodeRuntime.runMain` keep owning SIGINT.
- The simulator stamps `DeviceId "simulator"` while the client stamps its own,
  so one tightening shows two ids in a side-by-side trace. Document it.
- The two decorators ship in `dist` and therefore owe the JSDoc rubric,
  compilable examples, and a flat re-export from `src/index.ts`.
