# Inbox

Zero-friction idea queue. One bullet per idea — a sentence, a link, a "what
if". No structure required; do not organize this file.

`/explore` triages it: each bullet becomes a new packet, attaches to an
existing packet's `CAPTURE.md`, or is struck through with a word of why.

## Queue

- Bug: opening a TCP connection has no timeout. Found on a real Rexroth Nexo
  (2026-09-19): with the controller's WLAN off, the attempt stayed in
  `Connecting` for 36 s until the network came back, instead of failing and
  retrying on the backoff schedule; with a longer outage it waits for the OS
  (~2 min on Linux). `TcpTransport.connect` calls `NodeSocket.makeNet` without
  `openTimeout`, which that function supports. Add a configurable connect
  timeout next to the other timeouts in `DeviceSettings`, with a test.

- Bug: a result recovered with MID 0064/0065 is acknowledged with MID 0062,
  but only a pushed MID 0061 takes an acknowledgement. Seen on the real Rexroth
  Nexo (2026-09-19): after recovering 2636 the client sent a 0062 right after
  the 0060 subscribe. The Nexo ignored it, but a 0062 names no result, so if a
  pushed 0061 is waiting in the delivery queue at that moment the controller can
  take the stray 0062 as its ack; if the application then goes down, that
  result is lost. Fix: `ResultDelivery` must not acknowledge results that came
  from recovery (`acknowledge` in `DeviceConnection.ts`, `routeUnsolicited` for
  `OldResult`, `GapRecovery`), with a test that asserts no 0062 after a 0065.

- Bug: the reconnect backoff never resets after a healthy session, although
  docs/REFERENCE.md promises it ("What it does" and ADR 6). The supervisor runs
  `Effect.retry(attempt, settings.reconnect)`, and `attempt` never succeeds: a
  session always ends by failing, so the schedule keeps its state. Measured with
  `TestClock` and `Schedule.exponential("500 millis")`: delays 500, 1000, 2000,
  4000 ms, then a 10 minute session, then 16000 ms instead of 500. With the
  30 s cap, after a few drops every reconnect waits up to 30 s. Fix: restart
  the schedule once a session reaches `Ready`, with a `TestClock` test.

- Bug (not reproduced yet): `DevicePool.add` can wait forever. It awaits the
  `started` deferred, which only the device fiber completes after
  `DeviceConnection.make` returns. If that fiber ends first, `started` is never
  completed: a defect lands in `catchCause`, which removes the slot and logs but
  leaves `started` alone, and an interruption (a `remove` of the same device, or
  the pool closing, while `add` is still waiting) skips it too. Network
  failures do not trigger it: `make` does no I/O, the connect happens later in
  the supervisor. Fix: complete `started` with `Deferred.failCause` (and on
  interruption), with a test for each path.
