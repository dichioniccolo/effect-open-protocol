# Wire-trace CLI: controller and client commands

## Status

<!-- Keep in sync with ops/manifest.json on every stage/status change. -->
Stage: `graduate`
Status: `graduated`

Source: [`ops/manifest.json`](./ops/manifest.json)

## Spark

Running this library against itself takes a chaos demo and a test harness. Two
plain commands would make the protocol observable by hand instead. One opens a
simulated controller on a port, the other connects to it and pulls results, and
both print the raw wire string they send and receive.

## Next Open Question

None. The packet graduated into [`goals/wire-trace-cli/`](../../goals/wire-trace-cli/),
which now carries the work. This packet stays as provenance.

## Read This First

1. [`ops/manifest.json`](./ops/manifest.json) - machine state: stage, status, open questions.
2. [`CAPTURE.md`](./CAPTURE.md) - raw dump (stage 0).
3. [`RESEARCH.md`](./RESEARCH.md) - prior art + capability inventory (stage 1, if present).
4. [`DECISIONS.md`](./DECISIONS.md) - grilling log (stage 2, if present).
5. [`BRIEF.md`](./BRIEF.md) - shaped pitch (stage 3, if present).
6. [`MAP.md`](./MAP.md) - decomposition (stage 4, if present).

## Trail

<Dated one-liners, newest first: what each session did and where it stopped.>

- 2026-09-18: graduated. `goals/wire-trace-cli/` scaffolded from
  `goals/_template`, `SPEC.md` seeded from the brief with no-gos as non-goals
  and rabbit holes as constraints, eight phases in `PLAN.md`, provenance ledger
  carried into the goal. Status flipped to `graduated`.
- 2026-09-18: brief approved, `MAP.md` written. One goal packet with six
  phases, the listener rebind kept as a stop condition rather than a packet
  boundary, first vertical slice is two terminals printing the same handshake.
  Ready to graduate.
- 2026-09-18: `BRIEF.md` drafted. Problem, small-batch appetite, a two-command
  sketch over one `Duplex` seam, six rabbit holes with the listener rebind
  named as the designated cut, and seven no-gos. Awaiting review.
- 2026-09-18: align done in four rounds. Nine decisions in `DECISIONS.md`,
  frontier empty. Two answers overrode the recommendation: fix the TCP
  refuse-connections hole by tearing down and rebinding the listener, and drop
  `--duration` in favour of Ctrl-C only. Appetite is a small batch. Advanced to
  shape.
- 2026-09-18: research done. External landscape covering Open Protocol Tester,
  Toxiproxy, `tc netem` and `effect/unstable/cli`, an in-repo inventory, and
  five NOT FOUND gaps in `RESEARCH.md`, with the provenance ledger in
  `research/SOURCES.md`. Advanced to align with a five-question frontier.
- 2026-09-18: packet opened, first dump filed in `CAPTURE.md`, held at capture.
