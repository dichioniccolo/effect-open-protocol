# Capture

<!--
Stage 0. Append-only raw dump: thoughts, links, screenshots (drop files in
assets/ and reference them), half-sentences, contradictions. Nobody tidies
this file; cleaning it up destroys provenance. New material goes under a new
dated heading at the bottom.
-->

## 2026-09-19

The chaos demo fails at scale. `bun run demo -- --seed 7 --duration 300
--devices 50 --fault-rate 0.2` reports 35444 of 74147 results lost, and the same
command on 9fbd480 (before the inbox fixes) loses 35054. Nothing is delivered
twice. Summary: [assets/chaos-300s-summary.txt](./assets/chaos-300s-summary.txt).

A 30 s run with 50 devices fails too, a few hundred lost, on both versions.
The seed does not make runs repeatable: timing is real.

Per device, the losses are a tail block (tool-2 lost 105-147, tool-6 lost
74-147) or a few single holes (tool-36: 28, 30, 45). At the end the simulator
says subscribed, nothing left to push, and the client says `Ready`. Some
devices sit in `Recovering` or `Subscribing` 30 s after the faults stopped.

No ack send and no offer into the delivery queue blocked for more than 3 s
during a whole run, so the delivery pipeline is not what stalls.

tool-41's timeline ([assets/tool-41-timeline.txt](./assets/tool-41-timeline.txt)):
the last pass fetched 26-125 (`recovered: 100`) and reported `skipped: 23`.
Nothing starts another pass once generation stops, so 126-148 stay on the
controller. In the 300 s run, 173 passes hit `recoveryLimit`.

Suspected causes:

1. A pass stops at `recoveryLimit` and nothing continues it until the next
   session or the next pushed gap.
2. The window runs from the watermark and counts results already delivered.
   A hole that keeps failing pins the watermark, so every pass re-reads the
   same block while the backlog above it grows. Fits the ~16000 duplicates.
3. Every MID 0004 on a 0064 counts as "missing", including the chaos fault's
   code 79 ("Command failed"), which is transient.
4. A 0065 that arrives after its request timed out is matched to the next 0064
   waiting (correlation is by MID), and recovery does not check the ID.
5. Passes are slow under faults (1 s per request, sequential, up to 5 passes),
   long enough to hold a session in `Recovering` for minutes.

Side note: controllers gave up on more results after the inbox fix (191 vs 90).
Likely the stray 0062s for recovered results were acking pushed results before,
the exact risk bug 2 removed. Not proven.

## 2026-09-19 (later)

After the first four fixes the 30 s run still lost about 250. Probing again
turned up three more causes:

- tool-39/tool-47: results produced while the handshake's recovery pass ran
  are never pushed (not subscribed yet), and nothing asks for them once the
  line goes quiet. Needs a pass after subscribing.
- The 300 s run then delivered 16085 results twice. Eviction: `Dedup.seen`
  only checks the last 1000 IDs, so a pass above a stuck watermark re-fetched
  IDs delivered long ago.
- tool-42 sat in `Recovering` for 94 s. The simulator accepted a new
  connection with `subscribed: true` left over from the old one and pushed
  0061 before 0060. Nothing consumes the result subscription during the
  handshake, so its queue (size 1) filled, the reader blocked, every 0065 went
  unread and every request timed out. A real controller does not push before
  0060, so the trigger is a simulator bug; the client's head-of-line blocking
  on a full subscription queue stays as a weakness.

Also: `docs/REFERENCE.md` says the same seed replays the same chaos run. It
does not: timing is real, and the same seed gave different numbers every run.

## 2026-09-19 (evening)

With the recovery fixes the solo 300 s run lost 0 but delivered 6 twice:
IDs below the watermark that had left the 1000-ID window. Then two runs in
parallel lost ~550 each. A probe found tool-41 in a hot loop: 1,885,766
"device connection stopped" errors. A session died while the results
subscription was being taken again; `Subscriptions.open` registered MID 61
(uninterruptible acquire) but the interrupt landed before
`DeviceConnection` remembered it. The next session's re-subscribe failed with
`AlreadySubscribed`, `orDie` made it a defect, and the supervisor restarted at
once from `Ready`, where `AttemptStarted` is invalid and dies again. Both are
older than today's changes. The loop also starves the other devices of CPU.

## 2026-09-19 (night)

Acceptance: `bun run demo -- --seed 7 --duration 300 --devices 50
--fault-rate 0.2` run alone: 74074 generated, 74074 delivered, 0 lost, 0
delivered twice.

Two 300 s runs in parallel (twice the CPU load) still lose: 513 and 1186 in
one pair, 0 and 1 in another. Recovery had caught up within the settle window,
so these are not late results. The devices involved ended with a pass that
gave up on pending IDs and then saw no gap for the rest of the run. One of
them (tool-35) got a late MID 0005 for a subscribe whose request had already
timed out, dropped as unsolicited. Suspect: under load, replies miss their
timeouts, and a subscribe that times out on a live session only logs "retrying
at the next handshake" while the session carries on with the controller's
subscription state unknown to the client.

## 2026-09-19 (late night)

The user's own solo run lost 662, and a repeat lost 443, all on one device
(tool-48). It was still catching up when the 30 s settle window closed: one
pass had taken 40 s and ended with all 100 IDs pending, because each 0064
waits 1 s and the pass asked for every ID in turn. Recovery was too slow on a
bad link, and a pass that gave up in the last seconds of an outage was never
retried, since no push or reconnect follows on a quiet line.
