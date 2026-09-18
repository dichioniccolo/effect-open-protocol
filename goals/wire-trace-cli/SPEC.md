# Wire-trace CLI spec

## Objective

Two runnable commands make Open Protocol observable by hand.

`bun run controller --port 4545` serves a simulated controller on a real TCP
port and stays up until Ctrl-C. `bun run client --port 4545` connects to it,
handshakes, subscribes, and prints every tightening result it is handed. Both
commands print every byte chunk and every reassembled frame they send and
receive, with control characters escaped, and both can inject seeded latency on
their own writes.

Shipped as a pull request driven to mergeable.

Source exploration: [`explorations/wire-trace-cli/`](../../explorations/wire-trace-cli/).
The shaped pitch is [`BRIEF.md`](../../explorations/wire-trace-cli/BRIEF.md),
the decomposition is [`MAP.md`](../../explorations/wire-trace-cli/MAP.md), and
every decision below is recorded with its rejected alternatives in
[`DECISIONS.md`](../../explorations/wire-trace-cli/DECISIONS.md).

## Non-Goals

Carried from the brief's no-gos.

- No pool and no multi-device mode. One client, one controller. Open Protocol
  allows a single client per controller and the library already models the
  refusal (`HandshakeRejected` code 96). Multi-device supervision stays
  `demo/chaos.ts`'s job.
- No `--duration` and no scripted-run mode. Runs end on Ctrl-C. A scripted run
  uses an external timeout.
- No trace viewer, no filtering feature, no replay-from-file. The trace is a log
  line and a JSONL file; `grep`, `jq` and `diff` are the tooling.
- No new dependency. Neither Toxiproxy nor `tc netem` becomes a requirement to
  run these commands.
- No replacement of `demo/chaos.ts`. It keeps proving the invariant over the
  in-memory transport. These commands show the protocol, they do not assert.
- No `--fault-kinds` selection flag. `FaultConfig.kinds` supports it and it may
  return later.
- No changes to the protocol codec, the connection state machine, or delivery
  semantics. The only existing behaviour this goal changes is `makeTcp`'s
  refuse path.

## Source Hierarchy

1. User objective or issue that created this packet.
2. `CLAUDE.md` and required skills.
3. Governing standards (`standards/`, `.patterns/`).
4. This `SPEC.md`.
5. `PLAN.md`.
6. `GOAL.md`.
7. Supporting `research/`, `ops/`, and `history/` files.

Higher sources outrank lower sources when they conflict.

## Target Surfaces

- `src/transport/` gains two shipped modules: a tracing `Duplex` decorator and a
  latency `Duplex` decorator, plus the escaping helper they share.
- `src/index.ts` re-exports both, flat, like every other module.
- `cli/controller.ts` and `cli/client.ts` are new entrypoints.
- `package.json` gains two scripts beside `demo`.
- `simulator/ControllerSimulator.ts`: `makeTcp`'s `refuse` parameter stops being
  `() => Effect.void`.
- `test/` gains coverage for escaping round-trips and for the traced handshake.
- `README.md` gains a section documenting both commands.

## Constraints

Carried from the brief's rabbit holes, plus the repo's standing rules.

- **The listener rebind is the designated cut.** It makes `makeTcp`'s lifecycle
  fault-driven, races `TIME_WAIT` on rebind, and interacts with the existing
  `openSockets` teardown that exists because Node keeps a listening server alive
  until its sockets are gone. If it resists, it reverts to the documented no-op
  and the rest of the goal ships.
- **Chunk and frame lines go on separate log levels**, so one `--log-level` flag
  chooses between the protocol conversation and everything that crossed the
  socket. A split frame produces three chunk lines and one frame line; a
  coalesced read produces one chunk line and two frame lines.
- **Escaping is correctness, not cosmetics.** Frames are latin1, end in NUL
  (`terminator`, `src/protocol/Header.ts`), and carry fixed-width padding
  (`padText`, `padNumber`, `src/protocol/Ascii.ts`). A round-trip test proves
  unescaping reproduces the exact bytes; an eyeball does not.
- **Stdin for the Enter trigger reads lines, not keypresses**, and
  `NodeRuntime.runMain` keeps owning SIGINT.
- **Two device ids for one tightening** is expected: the simulator stamps
  `DeviceId "simulator"` (`simulator/ControllerBehaviour.ts`) while the client
  stamps its own `--device-id`. Document it in the README rather than change
  either side.
- **The two decorators ship**, so the JSDoc rubric applies
  (`.patterns/jsdoc-documentation.md`): compilable `**Example**` sections,
  `@category`, `@since`.
- Effect-first code laws apply (`.claude/skills/effect-first-development`), and
  schema work follows `.claude/skills/schema-first-development`.
- Latency is drawn from the seeded `Random`, so a run with the same `--seed`
  replays.
- Each command delays only its own writes. One-way latency composes into a
  round trip without either side coordinating.

## Decisions

Full rationale and rejected options live in the exploration's
[`DECISIONS.md`](../../explorations/wire-trace-cli/DECISIONS.md). Summary:

| Decision | Choice |
| --- | --- |
| Latency model | In process, seeded, both directions, at the `Duplex` seam |
| Latency knobs | `--latency <ms>` and `--jitter <ms>`, per direction, seeded |
| Trace granularity | Both the byte chunk and the reassembled frame, tagged |
| Trace output | stdout via the Effect logger, escaped, plus optional `--trace-file` JSONL |
| Decorator placement | `src/transport/`, shipped in the public API |
| Repo wiring | New `cli/` directory, two entrypoints, two `bun run` scripts |
| Client scope | One device against one controller |
| Fault exposure | Full `FaultKind` catalogue via `--fault-rate`; latency separate |
| Result production | `--result-interval` timer plus Enter to produce one now |
| Outage scope | A rebind drops open sessions, the way a reboot does |
| Run lifetime | Ctrl-C only, with a summary printed on the way out |
| Appetite | Small batch, one focused session |

Two of these overrode the recommendation given during alignment: fixing the TCP
refuse-connections hole by tearing down and rebinding the listener, and dropping
`--duration`.

## Acceptance Criteria

- [ ] `bun run controller --port <p>` binds the port, serves Open Protocol, and
      stays up until Ctrl-C.
- [ ] `bun run client --port <p>` reaches `Ready` against it, and prints every
      result the controller produces.
- [ ] Both commands print, for every byte chunk and every reassembled frame,
      the direction, the byte count, the MID where one applies, and the raw
      string with NUL and padding visible.
- [ ] Chunk lines and frame lines sit on different log levels, selectable with
      `--log-level`.
- [ ] `--trace-file <path>` writes one JSON object per event.
- [ ] `--latency` and `--jitter` delay that command's own writes, drawn from the
      seeded `Random`; two runs with the same `--seed` produce the same delays.
- [ ] `--fault-rate` reaches the whole `FaultKind` catalogue on the controller.
- [ ] `--result-interval` produces results on a timer, and pressing Enter
      produces one immediately.
- [ ] Ctrl-C prints a summary: generated and abandoned for the controller,
      delivered, duplicates and final state for the client.
- [ ] A result produced while the link is down is delivered after recovery, via
      MID 0064 and 0065, and the trace shows it.
- [ ] Escaping round-trips: unescaping a traced frame reproduces the exact bytes
      the socket carried, proven by a test.
- [ ] Either `refuseConnections` tears down and rebinds the TCP listener,
      dropping open sessions, or the cut is taken and the no-op is documented in
      `README.md` and in this packet's evidence.
- [ ] Both shipped modules satisfy the JSDoc rubric and are re-exported from
      `src/index.ts`.
- [ ] `README.md` documents both commands, their flags, and the two-device-id
      note.
- [ ] No unrelated refactors or formatting churn.

## Verification Matrix

| Check | Command or evidence | Required result |
| --- | --- | --- |
| Type check | `bunx tsc --noEmit` | Passes |
| Tests | `bun run test` | Passes |
| Build | `bun run build` | Passes |
| Handshake trace | Start both commands on a free port, capture both traces | MID 0001, 0002, 0060, 0005 appear from opposite directions, raw and escaped |
| Seeded replay | Two runs, same `--seed --latency --jitter --trace-file` | Trace files diff clean |
| Packet launcher size | `test "$(wc -m < goals/wire-trace-cli/GOAL.md)" -le 4000` | Passes |
| Manifest JSON | `jq . goals/wire-trace-cli/ops/manifest.json` | Passes |
| Whitespace | `git diff --check -- goals/wire-trace-cli` | Passes |

## Stop Conditions

- Required source files are missing or materially contradictory.
- The implementation would exceed named scope.
- Verification requires credentials, cost, destructive side effects, or policy
  approval not named in this spec.
- The same blocker repeats after reasonable investigation.
- **The listener rebind fights back.** Take the cut, revert `makeTcp` to the
  documented no-op, record it as evidence, and ship the rest. Do not spend the
  appetite here.

## Exception Ledger

| Exception | Scope | Owner | Rationale | Removal condition |
| --- | --- | --- | --- | --- |
| None | N/A | N/A | N/A | N/A |
