# Decisions

<!--
Stage 2. The grilling log. One entry per resolved branch-closing question,
newest last. Unresolved questions live in ops/manifest.json `openQuestions`
until they land here. Deferred questions get an entry too, marked DEFERRED
with the reason.
-->

## 2026-09-19 — dynamic-means-code

**Question:** What does "define new MIDs dynamically" mean: definitions in
code with an open registry, definitions loaded from data at runtime, or both?

**Answer:** Code, open registry. Users write MID definitions as Schema values
in their own code and hand them to the library. The registry is open, and
TypeScript sees every definition.

**Rationale:** Recommended. It is the only reading compatible with "fully type
safe" in `CAPTURE.md`, and it fits the repo's schema-first law. Rejected:
loaded from data, since nothing can be typed statically, which contradicts the
capture; both tiers, since two surfaces means more scope, and `UnknownMessage`
already covers raw ad-hoc MIDs.

## 2026-09-19 — revision-picked-by-caller

**Question:** Who picks the revision when a message is sent?

**Answer:** The caller, per request. The call site names the revision, and the
message and reply types narrow to exactly that revision. A controller that
refuses the revision answers `0004`, which surfaces as the existing typed
`CommandRejected` error.

**Rationale:** Recommended. It is the most type-precise option. Rejected:
per-connection config (MID → revision in `DeviceSettings`), because the
revision would only be known at runtime and types widen to a union of every
revision; auto-negotiation, for the same widening plus extra round trips, and
because refusal behaviour is unverified (RESEARCH §Constraints Discovered).

## 2026-09-19 — migrate-built-ins

**Question:** Do the built-in MIDs (0001–0005, 0060–0065, 9999) move onto the
new definition mechanism?

**Answer:** Migrate all. Built-ins become definitions like any user MID.
`wireFormat`, `dataOf` and the hand-rolled slot codec in
`src/protocol/TighteningResult.ts` are removed in favour of the one codec path.

**Rationale:** Recommended. One codec path, and it proves the mechanism on the
hardest real layouts (0061/0065 parameter slots) under the existing test
suite. Rejected: new mechanism beside the old one, then migrating later (two
paths coexist, and the mechanism goes untested on hard layouts); beside it
forever (permanent duplication, no dogfooding).

## 2026-09-19 — simulator-rejects-custom

**Question:** Does the controller simulator need to answer custom
(user-defined) MIDs?

**Answer:** No. The simulator answers a MID it does not know with `0004`
(unknown MID). Custom MIDs are tested through codec round trips and the
in-memory transport, not through simulator handlers.

**Rationale:** User chose this over the recommended handler hook (simulator
takes the same definitions plus a request → reply handler). It keeps simulator
scope out, at the cost of no end-to-end request/reply over the simulator for
custom MIDs. Built-ins keep their current simulator behaviour, since only the
codec path moves. Rejected: handler hook (recommended), and deferring it to
later.

## 2026-09-19 — type-per-revision

**Question:** How are a MID's revisions typed?

**Answer:** One Schema per revision with exact fields. The MID's type is a
union discriminated by a `revision` literal. By default rev N is built from
rev N-1 plus its new fields (cumulative); a revision may redefine the layout
outright when the specification changes a field instead of appending one.

**Rationale:** Recommended. `Mid.rev(3)` carries exactly the rev 3 fields,
which is what "fully type safe revisions" asks for. The cumulative default
follows OpenProtocolInterpreter's model (RESEARCH §External Landscape), and the
override covers the unverified non-append case (RESEARCH §Constraints
Discovered). Rejected: one type with optional later fields (the
OpenProtocolInterpreter weakness: rev 1 values show rev 8 fields as maybe
present); independent full revisions (precise but repetitive, e.g. 8 copies
for 0002).

## 2026-09-19 — reply-on-definition

**Question:** Where is the reply a MID expects declared?

**Answer:** On the definition, `Rpc.make`-style. A request definition declares
`reply` as one of: another MID definition (dedicated reply, e.g. 0064 → 0065),
`accepted` (generic 0005, with 0004 surfacing as `CommandRejected`), or none
(fire-and-forget). `request(definition, payload)` returns an Effect typed from
the definition alone, and call-site `expectReply(mid, direct?)` goes away.

**Rationale:** Recommended. It mirrors `Rpc.make({ payload, success, error })`
(`unstable/rpc/Rpc.ts:902-935`), and the pairing is written once instead of at
every call site (`Handshake.ts:30`, `Session.ts:106`, `GapRecovery.ts:77`,
`ResultRecovery.ts:105`). Rejected: a typed reply argument at the call site
(repeats the pairing); separate command-pair objects (one more concept to
learn and register).

## 2026-09-19 — field-dsl

**Question:** How does a user describe a MID's data-field layout?

**Answer:** A field DSL whose constructors (`Field.digits`, `Field.text`,
`Field.literal`, ...) each return a real Schema (string ⇄ T via `decodeTo`)
carrying typed annotations (parameter ID, width, padding). A message layout is
an ordered record of fields. It covers both parameter-ID layouts (0061's
`01…02…`) and bare positional ones (0004's `MMMMCC`).

**Rationale:** Recommended. Width and ID mistakes are caught when the
definition is built. It generalises the private slot codec in
`TighteningResult.ts` and reuses `Ascii.ts` (`padNumber`, `padText`,
`parseDigits`). Rejected: plain schemas with annotations read by a generic
compiler (loose, easy to forget, fail only at runtime); a positional tuple
(can't express parameter-ID layouts).

## 2026-09-19 — typed-subscribe-stream

**Question:** How are pushed (unsolicited) custom MIDs decoded?

**Answer:** `connection.subscribe(definition)` sends the definition's subscribe
MID (if it has one) and returns a Stream of that MID's typed values. The
connection keeps a registry of the definitions currently subscribed: frames
for them decode typed, and everything else stays `UnknownMessage`.

**Rationale:** Recommended. Registration follows usage, and no type parameter
is threaded through `DeviceConnection`, `DevicePool` and the layers. Rejected:
a registry at construction (precise, but generics spread through every
service); request/reply only with a manual `decodeAs` (leaves pushes untyped,
which misses the capture's intent).

## 2026-09-19 — reply-revision-mapped

**Question:** When a request goes out at revision N, which revision of the
reply is expected?

**Answer:** Mapped per revision. The request definition declares, per
revision, which reply revision answers it (e.g. 0001 rev 3 → 0002 rev 3),
checked at compile time. The reply type is exact.

**Rationale:** Recommended. It covers specifications where request and reply
revisions diverge, and keeps the exact reply type from `revision-picked-by-caller`.
Rejected: always the same revision (can't express divergent pairs); any reply
revision (union type, callers narrow by hand).

## 2026-09-19 — undefined-revision-falls-back

**Question:** What happens when an incoming frame is for a known MID at a
revision its definition doesn't define, or its body fails to decode?

**Answer:** Fall back to `UnknownMessage { mid, revision, data }` and log a
warning. The session survives. A pending request whose expected reply arrives
at an undefined revision fails at once with a typed error (working name
`UnexpectedRevision`) rather than waiting for the timeout.

**Rationale:** Recommended. Today any `PayloadDecodeError` ends the session
(`Session.ts:78`), so a controller answering at a newer revision would
reconnect-loop. Rejected: keeping that behaviour; a typed error on the pending
request with other bad frames dropped silently (leaves no trace).

## 2026-09-19 — consumer-acks

**Question:** Pushed MIDs that need an acknowledgement (like 0061 → 0062):
when is the ack sent for a subscribed custom MID?

**Answer:** The definition declares its ack MID. Each stream element carries an
`ack` Effect the consumer runs once it has handled the value. An element never
acked is resent by the controller, as today.

**Rationale:** Recommended. It extends the library's "acknowledge only after
your handler succeeded" guarantee (README §Delivery semantics) to custom MIDs.
Rejected: auto-ack on receipt (at-most-once, contradicts the delivery promise);
a handler-based `subscribe(def, handler)` (safe, but loses Stream composition).

## 2026-09-19 — subscriptions-survive-reconnect

**Question:** What happens to a custom subscription stream when the connection
drops and reconnects?

**Answer:** Active subscriptions are re-sent after every handshake, like the
built-in 0060 subscription, and the Stream keeps emitting across reconnects.
It ends only when the consumer stops or the connection closes.

**Rationale:** Recommended. It matches the library's promise to keep
connections alive through network failures. Rejected: the stream failing with
`ConnectionLost` (every consumer would reimplement retry).

## 2026-09-19 — results-on-subscribe

**Question:** Does the built-in tightening-result path (`ResultDelivery`,
dedup, gap recovery) sit on top of the generic subscribe primitive?

**Answer:** Yes. 0060/0061/0062 become a subscribe definition, and
`ResultDelivery` consumes `subscribe(LastResult)`, adding dedup, gap recovery
and ack-after-handler on top.

**Rationale:** Recommended, consistent with `migrate-built-ins`. One push path,
used by the library's most critical feature and covered by the existing
Delivery, Chaos and GapRecovery tests. Rejected: keeping it special (less risk
to delivery guarantees, but two push paths coexist).

## 2026-09-19 — no-generic-dedup

**Question:** Should the generic subscribe stream deduplicate resent pushes
for custom MIDs?

**Answer:** No. `subscribe` delivers every frame, resends included, and
consumers stay idempotent. Dedup stays a `ResultDelivery` concern keyed by
`tighteningId`.

**Rationale:** Recommended. A generic stream can't know a custom MID's identity
without the user declaring one, and the README already requires idempotent
handlers. Rejected: an optional `key` on the definition (free dedup, but it
moves `Dedup` into the generic layer and widens scope).

## 2026-09-19 — break-request-api

**Question:** How is the old `DeviceConnection.request(message, mid, direct?)`
handled once `request(definition, payload)` exists?

**Answer:** Replaced outright. README and JSDoc examples are updated.

**Rationale:** Recommended. The package is `0.0.0` and private, and keeping the
untyped form would preserve the gap this exploration closes. Rejected:
deprecating it and keeping it a while (two request paths, and `expectReply`
survives).

## 2026-09-19 — inherited-boundaries

**Question:** Which limits carry over unchanged? Not asked; recorded so
nothing is silently assumed.

**Answer:** Unchanged: one outstanding request at a time with no correlation
ID; header `noAck` stays `false` and station/spindle stay `1` on send;
multi-part messages (non-zero sequence number / message parts) stay
`UnsupportedFeature`; field tables are written from the specification in our
own words.

**Rationale:** All come from RESEARCH §Constraints Discovered and the existing
header codec. None was challenged in capture or in any align round. Reopen
here if shaping needs one of them.
