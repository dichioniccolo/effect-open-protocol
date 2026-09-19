# Map

<!--
Stage 4. Decomposition into candidate goal packets. This is the graduation
surface: the definition-of-ready in explorations/README.md is checked against
this file. Every major component cites an existing repo capability or is
explicitly marked NET-NEW.
-->

Two goal packets, split where the risk changes. The first builds the mechanism
and moves every codec and request/reply exchange onto it. The second moves the
push path, `ResultDelivery` included, which is where the delivery guarantees
live. Each lands as its own PR with the suite green.

Paths are under `packages/open-protocol/` unless noted. Effect cites are under
`.repos/effect/packages/effect/src/`.

## Candidate Goal Packets

| Slug | Mission | Depends on | Capabilities cited |
| --- | --- | --- | --- |
| `typed-mid-definitions` | Field codec, per-revision MID definitions with declared replies, a definition-driven codec, and typed `request(def.rev(n), payload)`. Every built-in codec migrates, the old request API is removed, the simulator answers `0004` for unknown MIDs, and one example custom MID proves the path in tests and the README. | none | **Field codec:** extends `src/protocol/TighteningResult.ts` slot codec (`Slot`, `readSlots`, `renderSlots`, `enumValue`) into a public module; reuses `src/protocol/Ascii.ts`; `Schema.decodeTo` (`Schema.ts:5387`), `SchemaTransformation.transform` (`SchemaTransformation.ts:381`), custom annotations (`Schema.ts:15005`). **Definitions:** NET-NEW module; pattern from `Rpc.make` (`unstable/rpc/Rpc.ts:902`); `S.TaggedClass` / `S.Literals` as used in `src/protocol/Messages.ts`. **Codec:** replaces `wireFormat`, `decoderFor`, `dataOf`, `midOf`, `revisionOf` (`src/protocol/Messages.ts:314-439`); reuses `src/protocol/Header.ts`, `UnknownMessage` (`Messages.ts:222`), `src/protocol/ProtocolError.ts`. **Typed request:** extends `src/connection/RequestReply.ts` (slot, one-permit semaphore, `Deferred`, `offer`) and `src/connection/DeviceConnection.ts:60,362`; reuses `CommandRejected` / `RequestTimeout` (`src/connection/ConnectionError.ts`); `UnexpectedRevision` error NET-NEW. **Call sites moved:** `src/connection/Handshake.ts:30,49`, `Session.ts:106`, `GapRecovery.ts:77`, `src/results/ResultRecovery.ts:105`. **Decode fallback:** changes `Session.ts:65,78`. **Simulator:** `simulator/ControllerBehaviour.ts:142` (`orElse` → `0004`). |
| `typed-subscriptions` | Typed `subscribe(sub.rev(n))`: a Stream of `{ value, ack }` that survives reconnects, with a registry of active subscriptions for decoding. `ResultDelivery` is rebuilt on `subscribe(LastResults)` and keeps dedup, gap recovery and ack-after-handler. | `typed-mid-definitions` | **Push dispatch:** replaces `routeUnsolicited` (`Match.tag("LastResult" / "OldResult")`) in `src/connection/DeviceConnection.ts:215-224` and the ack send at `:184`; keeps the offer-to-`RequestReply`-first order at `src/connection/Session.ts:66`. **Restore after reconnect:** extends the 0060 re-subscribe in `src/connection/Handshake.ts:49`. **Delivery:** reuses `src/results/ResultDelivery.ts`, `src/results/Dedup.ts`, `src/results/ResultRecovery.ts`, `src/connection/GapRecovery.ts`. **Stream surface:** `Stream`, `Queue` (Effect). Subscription registry and the `{ value, ack }` element are NET-NEW. Challenged whether the registry could be `RequestReply`'s slot: no, since that slot holds one pending request, while subscriptions are many and long-lived; they share only the "offer, then fall through" dispatch shape. |

## Sequencing

1. **`typed-mid-definitions`, first bet.** Everything else composes it.
   Internal order:
   1. Field codec, proven by today's 0061/0065 round-trip tests.
   2. Definitions and codec, with every built-in migrated; the `Messages`
      round-trip tests stay unchanged in behaviour.
   3. Typed `request`, moving the handshake, keep-alive, gap recovery and
      `ResultRecovery` call sites, and removing the old API.
   4. Body decode fallback plus `UnexpectedRevision`.
   5. Simulator `0004` for unknown MIDs.
   6. Example custom MID, README and JSDoc.

   The appetite cut order (`extend` helper, then mapped reply revisions)
   applies here.
2. **`typed-subscriptions`, follow-on.** It needs definitions and typed
   `request` (subscribe and unsubscribe are requests with `accepted`
   replies). Internal order: `subscribe` for the example custom MID first,
   then `ResultDelivery` moved onto it last, guarded by the Delivery, Chaos,
   GapRecovery and Shutdown tests.

**Why two goals, not one:** the sibling exploration went single-goal. Here the
second half touches the delivery guarantees and deserves its own review. The
first PR is complete and useful alone: typed custom MIDs and replies, with
pushes still `UnknownMessage` for custom MIDs. Collapsing both into one goal
with two phases is the alternative if you prefer fewer packets.

Nothing is gated or optional. Both candidates are promised now.

## First Vertical Slice

Inside `typed-mid-definitions`: the **0064 → 0065 exchange end to end on the
new path**. It lands when:

- `Field.*` encodes and decodes the 0065 body (the hardest layout: parameter
  IDs, filler, enum digits), and the 0065 round-trip property test (`test/protocol/Messages.test.ts:176`) passes against
  it.
- `RequestOldResult` is a request definition whose revision 1 reply is
  `OldResult.rev(1)`.
- `request(RequestOldResult.rev(1), { tighteningId })` over the in-memory
  transport and simulator returns a value typed as `OldResult` revision 1,
  pinned by an `expectTypeOf` test.
- `GapRecovery` uses that call, and the GapRecovery tests stay green.

That proves every layer (field, definition, codec, typed request) on a real
MID before the rest migrate.

## Open Risks Inherited From The Brief

- Type-level cost of revision maps and reply mapping: pin exact types with
  `expectTypeOf`, and cut per Appetite if it sprawls.
- Layout order must never rely on object key order: layouts are arrays.
- The 0061/0065 layouts are the field codec's acceptance test, and existing
  round trips must pass unchanged.
- Delivery guarantees during the `ResultDelivery` move (`typed-subscriptions`):
  it migrates last, behind the existing suites.
- Pushes during a pending request: keep offering to `RequestReply` first, and
  keep acks out of the request slot.
- The body decode fallback must not hide corruption: framing and header errors
  still end the session, and warnings carry MID, revision and reason.
- `accepted` (0005/0004) replies match by MID only; revision checks apply to
  dedicated replies.
- Field tables are written from the specification in our own words.
