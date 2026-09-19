# Brief

<!--
Stage 3. The shaped pitch (Shape Up anatomy). Fat-marker fidelity: concrete
enough to evaluate and decompose, rough enough to leave design latitude to
the implementing goal packets. The exploration is shaped when the human says
this file matches the picture in their head.
-->

Decisions behind every line here are in [`DECISIONS.md`](./DECISIONS.md), and
the evidence is in [`RESEARCH.md`](./RESEARCH.md). This brief doesn't restate
their rationale.

## Problem

`effect-open-protocol` speaks a fixed subset of Open Protocol. The subset is
closed in three places at once:

- The `Mid` literal set and the `Message` union are closed.
- A new message means editing both the `wireFormat` table and the `dataOf`
  encoder.
- Every modelled message goes out at revision 1, and nothing reads a body by
  revision.

Anyone who needs another MID, or a newer revision of an existing one, has to
fork the library or fall back to `UnknownMessage` and parse raw strings.

Replies are untyped too. `request` returns a plain `Message`. Every caller
names the expected reply at the call site (`expectReply(mid, direct?)`) and
narrows by hand. The pairing between a request and its answer is written
again at each call site instead of once.

Real controllers differ by revision, and real integrations need MIDs beyond
tightening results (parameter sets, job info, alarms, ...). Without an open,
typed way to define them, the library stops at its demo subset.

## Appetite

**One library refactor, not a MID catalogue.** Scope is the mechanism plus
migrating what already exists onto it:

- The field codec.
- MID definitions with typed revisions and replies.
- Typed `request` and `subscribe` on the connection.
- The built-ins, `ResultDelivery` included, moved onto it.

The only new MID is **one example custom MID**, used in tests and the README to
prove the path end to end.

The budget is guarded by the existing test suite. Every step lands with the
suite green, and the migration never takes a step that leaves the delivery
guarantees untested. If the type-level design turns out expensive, cut in this
order:

1. The cumulative `extend` helper. Revisions are written out in full: still
   exact, just verbose.
2. Mapped reply revisions collapse to "same revision" for the built-ins.

Never cut the exactness of revision and reply types. That is the point of the
exploration.

## Solution Sketch

Five elements, bottom up. The names and shapes below are fat-marker
illustrations, not an API contract.

**1. Field codec: `Field.*` constructors return Schemas.**
Each constructor is a `Schema` between the fixed-width string and a typed
value, built with `decodeTo` over `Ascii.ts` primitives. It carries typed
annotations for width, padding and optional parameter ID. A layout is an
**ordered** list of fields. Parameter-ID layouts (`01` + value, `02` + value,
..., as in 0061) and bare positional layouts (0004's `MMMMCC`) both fit.
Filler fields exist on the wire but not in the decoded type. This generalises
the private slot codec in `TighteningResult.ts`, which then goes away.

```ts
Field.digits({ id: "01", width: 4 })          // 1234 ⇄ "011234"
Field.text({ width: 25 })                      // "ctrl" ⇄ "ctrl" + 21 spaces
Field.filler({ id: "10", width: 2 })           // on the wire, not in the type
Field.digits({ width: 10, schema: TighteningId })
```

**2. MID definitions: one Schema per revision.**
A definition names its MID number and a map of revisions. Each revision is a
tagged Schema whose decoded value carries a `revision` literal, so a MID's
type is a union discriminated by revision. By default revision N extends
revision N-1. A revision may also replace the layout outright.

A request definition also declares its reply per revision:
- another definition at a given revision (0064 → 0065),
- `accepted` (0005; 0004 becomes `CommandRejected`),
- or none (fire-and-forget).

A subscription definition names its subscribe, data, ack and unsubscribe MIDs.

```ts
const RequestOldResult = Mid.request(64, {
  revisions: { 1: [Field.digits({ width: 10, schema: TighteningId })] },
  reply: { 1: OldResult.rev(1) }
})

const LastResults = Mid.subscription({ subscribe: 60, data: LastResult, ack: 62, unsubscribe: 63 })
```

**3. Codec: encode by definition, decode against what's known.**
`encode(definition.rev(n), value)` writes the header revision from the value.
Decoding a frame looks the MID up among known definitions: built-ins, active
subscriptions and the pending request's expected reply. If there's no
definition, or the revision is undefined, or the body fails to decode, the
frame becomes `UnknownMessage` with a warning. Header-level errors still end
the session as today.

**4. Connection surface.**
- `request(definition.rev(n), payload)` is `Effect<Reply of rev n, ...>`,
  typed entirely from the definition. A reply that arrives at an undefined
  revision fails the pending request at once with a typed error (working name
  `UnexpectedRevision`).
- `subscribe(subscription.rev(n))` is a `Stream` of `{ value, ack }`. The
  consumer runs `ack` after handling a value. Active subscriptions are re-sent
  after every handshake, and the stream lives across reconnects.
- The old `request(message, mid, direct?)` and `expectReply` are removed.

**5. Migration.**
- Built-ins (0001–0005, 0060–0065, 9999) become definitions.
- The handshake, keep-alive and gap recovery use typed `request`.
- `ResultDelivery` consumes `subscribe(LastResults)` and keeps dedup, gap
  recovery and ack-after-handler on top.
- `wireFormat`, `dataOf`, the slot codec and the closed `Mid` literal set are
  deleted.
- The simulator keeps its built-in behaviour and answers any MID it doesn't
  model with `0004` (unknown MID).

```text
Field.* ──► Mid definitions (rev Schemas, reply map) ──► codec ──► Session / RequestReply
                                                                   ├─ request(def.rev(n)) : typed reply
                                                                   └─ subscribe(sub.rev(n)) : Stream<{ value, ack }>
                                                                          └─ ResultDelivery (dedup, gaps, ack after handler)
```

## Rabbit Holes

- **Type-level cost.** Revision maps, cumulative `extend` and mapped reply
  revisions all live in the type system. Errors can turn unreadable, and
  checking can get slow. *Patch:* definitions are `const` values with shallow
  generics, the reply type is computed from one indexed access, and type tests
  (`expectTypeOf`) pin exact types for 0002 (multi-revision) and 0064 → 0065
  (dedicated reply). If it still sprawls, cut per Appetite.
- **Field order.** A layout is positional, so it must not depend on object
  key order. *Patch:* layouts are arrays (or ordered tuples of named fields),
  never plain records.
- **0061/0065 layouts.** Parameter IDs, filler fields and enum-coded digits
  (`TighteningStatus`, `LimitStatus`) are the hardest real case. *Patch:* they
  are the acceptance test for the field codec. Today's encode/decode
  round-trip tests must pass unchanged.
- **Delivery guarantees during migration.** Rebuilding `ResultDelivery` on
  `subscribe` touches the library's most critical path: ack only after the
  handler succeeds, dedup, gap recovery on reconnect. *Patch:* it migrates
  last, and the Delivery, Chaos, GapRecovery and Shutdown tests guard it.
- **Pushes during a pending request.** One outstanding request, no correlation
  ID. A pushed 0061 can arrive while 0064 waits for 0065, and an `ack` is a
  send, not a request. *Patch:* keep today's order (`RequestReply.offer` first,
  then subscribers), and keep acks outside the request slot.
- **Softer decode failures.** Today a `PayloadDecodeError` ends the session
  (`Session.ts:78`). Falling back to `UnknownMessage` must not hide real
  corruption. *Patch:* only body decoding falls back; framing and header
  errors keep ending the session. The warning log carries MID, revision and
  reason.
- **Matching `accepted` replies.** 0005 and 0004 carry the MID they answer,
  not a revision. *Patch:* `accepted` replies keep matching by MID only;
  revision checks apply to dedicated replies.
- **Specification text.** New field tables (including the example custom MID)
  are written from the specification in our own words, never pasted (RESEARCH
  §Constraints Discovered).

## No-Gos

- Definitions loaded from data at runtime (JSON, config). Only code-defined,
  statically typed definitions.
- Revision negotiation, or per-connection revision config. The caller picks.
- A MID catalogue: beyond the migrated built-ins, only one example custom MID.
- Simulator handlers for custom MIDs. The simulator answers `0004`.
- Generic dedup in `subscribe`. Consumers stay idempotent; dedup remains
  `ResultDelivery`'s.
- Keeping the old `request(message, mid, direct?)` API or a deprecation
  window.
- Multi-part messages, the header `noAck` flag, and station/spindle other than
  `1`.
- Changes to the trace UI or the store. They read headers and raw frames only.
