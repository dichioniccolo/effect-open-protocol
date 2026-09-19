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
