# Research

<!--
Stage 1. Ground the capture in reality. Two halves: what exists outside the
repo (cited), and what exists inside it (so we compose bricks instead of
rebuilding them). Date sections; research goes stale.
-->

## External Landscape (2026-09-19)

### Open Protocol libraries

**OpenProtocolInterpreter** (C#, MIT) —
<https://github.com/Rickedb/OpenProtocolInterpreter>

- One class per MID (`Mid0002`, `Mid0061`, ...). Each property carries an
  attribute giving the revision that introduced it, its field number, offset
  and width, e.g.
  `[StringDataFieldDefinition(revision: 3, field: 5, Index = 62, Size = 19)]`
  ([Mid0002.cs](https://github.com/Rickedb/OpenProtocolInterpreter/blob/master/src/OpenProtocolInterpreter/Communication/Mid0002.cs)).
- Revisions are **cumulative**: parse and pack use every field whose revision is
  at or below the header's revision. MID 0002 grows through 8 revisions
  (rev 2 adds supplier code, rev 3 software versions, ... rev 8 tool lock).
- Custom MIDs are registered at runtime with
  `new MidInterpreter().UseCustomMessage(new Dictionary<int, Type> { ... })`, or
  by subclassing an existing MID (README).
- Request/reply is modelled with marker interfaces and helper methods such as
  `new Mid0061(2).GetAcknowledge()` returning `Mid0062` (README). The reply is a
  method on the message, but the transport does not check it against the type.
- It dispatches through a MID → type dictionary, and builds instances through
  reflection (README). Active: CI, NuGet package, about 700 commits.
- **Fit:** the closest prior art to the capture. The data model (fields
  tagged with the revision that introduced them, cumulative revisions, a
  registry open at runtime) carries over well. Its typing does not: revisions
  do not narrow the type, since a rev 1 `Mid0002` still has every rev 8
  property, only unset.

**node-open-protocol** (JavaScript, GPL-3.0) —
<https://github.com/st-one-io/node-open-protocol>

- One file per MID, holding a parser and a serializer: "Implementing support
  for a new MID is as easy as dropping a new file with the respective parser
  and serializer functions" (README).
- Revision defaults to 1 unless it is passed in `opts`. `sendMid()` can send a
  MID the library does not implement, as a raw payload (README).
- No reply typing: the README only notes that "request MIDs normally have a
  counterpart MID for the reply". No TypeScript types.
- **Fit:** reference only (GPL-3.0, so clean-room). It shows the per-file MID
  layout, and what the gap looks like when replies are untyped.

**Other ecosystems**, from one search and not inspected:
[Wahlengm/Atlas-Copco-Open-Protocol](https://github.com/Wahlengm/Atlas-Copco-Open-Protocol),
[YangWenLong1222/openprotocol](https://github.com/YangWenLong1222/openprotocol)
(Python);
[MicroFocus/sv-ops2sd](https://github.com/MicroFocus/sv-ops2sd), which turns the
Open Protocol specification into fixed-length service descriptions. That last
one suggests MID layouts can be treated as data.

### Effect Schema (v4) building blocks

Checked against the linked source `.repos/effect` at `9ad9891e24`.

- **Custom annotations:** `declare module "effect/Schema" { namespace
  Annotations { interface Annotations { ... } } }` extends the annotation
  record with typed keys, and `Schema.resolveAnnotations(schema)` reads them
  back (`packages/effect/src/Schema.ts:15005-15050`). A field schema could carry
  `{ parameterId, width, since: revision }` this way.
- **Transformations:** `Schema.decodeTo`, and `SchemaTransformation.transform`
  / `transformEffect` (`Schema.ts:5387`, `SchemaTransformation.ts:332,381`),
  build `string ⇄ Type` codecs. A fixed-width field would be a
  `decodeTo(target)(String)` with a padding and parsing transformation.
- **`Schema.TemplateLiteralParser`** decodes a string into a typed tuple, but it
  splits on separators, with greedy backtracking and a documented round-trip
  gotcha (`Schema.ts:2797-2850`). That doesn't fit positional fixed-width
  data.
- **`Schema.TaggedClass` / `TaggedUnion` / `Literals`** give tagged message
  classes and closed MID literal sets (`Schema.ts:6276`, `4800`, `14091`).
- **Typed request/response prior art: `effect/unstable/rpc` `Rpc.make(tag,
  { payload, success, error })`** (`unstable/rpc/Rpc.ts:902-935`). The request
  definition carries its success and error schemas, so the client gets
  `Effect<Success["Type"], Error["Type"]>` from the definition alone. This is
  the shape the capture asks for ("the answer should be fully type safe").
- No library pairing Effect Schema with fixed-width positional text turned up
  in one search. The effect-smol
  [SCHEMA.md](https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/SCHEMA.md)
  covers canonical JSON/FormData/URLSearchParams codecs only. Fixed-width
  codecs exist in other languages, e.g. Go
  [go-fixedwidth](https://github.com/ianlopshire/go-fixedwidth) with
  `fixed:"{start},{end},{align},{pad}"` struct tags. Treat an Effect version as
  NET-NEW.

## In-Repo Capability Inventory (2026-09-19)

All paths are under `packages/open-protocol/`.

| Capability | Where | State |
| --- | --- | --- |
| Closed MID set | `src/protocol/Messages.ts:36` — `Mid = S.Literals([1, 2, 3, 4, 5, 60, ..., 9999])` | Closed at compile time. No way to add a MID from outside. |
| Message model | `src/protocol/Messages.ts:48-238` — one `S.TaggedClass` per message, plus a closed `Message` union | Schema-first, but the union is hand-written and closed. |
| MID ↔ codec registry | `src/protocol/Messages.ts:314-345` — `wireFormat` keyed by `_tag` with `satisfies`, then `decoderFor: Map<number, decode>` | The one place a MID is declared, but private and not extensible. Decoders are hand-written `Result` code, not Schemas. |
| Encoding | `src/protocol/Messages.ts:383-439` — `dataOf` is a `Match.tag` chain, `midOf` reads `wireFormat` | Encode and decode live in separate places: a new message touches `wireFormat` **and** `dataOf`. |
| Revisions | `src/protocol/Header.ts:75,110,154` decode and encode the header revision. `Messages.ts:383` `revisionOf` hard-codes **1** for every modelled message | **NOT FOUND**: nothing selects a body layout by revision. Only `UnknownMessage` keeps its revision. |
| Unknown MIDs | `src/protocol/Messages.ts:222-234` `UnknownMessage { mid, revision, data }` | Escape hatch for untyped raw data. Encodes back verbatim. |
| Parameterised fields (`id` + width) | `src/protocol/TighteningResult.ts` — `Slot { id, width, field, render }`, `readSlots`, `renderSlots`, `digits` / `text` / `verbatim` / `zeros`, `enumValue` | A working fixed-width codec for MID 0061/0065, but hand-rolled, private and specific to `TighteningResult`. The closest brick to a Schema field codec. |
| ASCII primitives | `src/protocol/Ascii.ts` — `parseDigits`, `padNumber`, `padText`, `isDigits` | Reusable as-is inside Schema transformations. |
| Typed errors | `src/protocol/ProtocolError.ts` — `PayloadDecodeError { mid, reason }`, `MalformedHeader`, `UnsupportedFeature` | Reusable. A Schema-driven decoder needs a mapping from `SchemaIssue` to `PayloadDecodeError`. |
| Request/reply correlation | `src/connection/RequestReply.ts` — `request(message, mid, expectation, timeout?) => Effect<Message, ...>`, `expectReply(mid, direct?)` matches `0005`/`0004` by MID or a direct reply by tag | Correlation works, but the **reply is untyped**: it returns `Message` and callers narrow by hand. The expected reply is passed at the call site (`Handshake.ts:30`, `Session.ts:106`, `GapRecovery.ts:77`, `ResultRecovery.ts:105`), not declared on the message. |
| Public request API | `src/connection/DeviceConnection.ts:60-64,362` — `request(message, mid, direct?) => Effect<Message, NotReady \| RequestTimeout \| CommandRejected \| ConnectionLost>` | Same gap, surfaced to users. |
| Simulator replies | `simulator/ControllerBehaviour.ts:112-156` — `Match.tag` on requests, returning `O.Option<Message>` | The server side of the same pairing. It would need to learn custom MIDs too, or keep ignoring them. |
| Schema-based request/response | `effect/unstable/rpc` (dependency, not used in repo) | Pattern reference only. Its transport and serialization don't apply. |

## Constraints Discovered

- **Single outstanding request.** The protocol allows one outstanding message
  at a time with no correlation ID. `RequestReply` enforces this with a
  one-permit semaphore (`RequestReply.ts`). Typed replies have to keep matching
  by MID (`0004`/`0005` carry the MID they answer) and by expected reply MID.
- **Two reply shapes.** A command is answered either by the generic
  `0005`/`0004` (accepted/rejected, carrying the MID) or by a dedicated data MID
  (`0001` → `0002`, `0064` → `0065`, `9999` → `9999`). A typed-reply design
  must express both, and the `0004` rejection belongs in the error channel
  (already `CommandRejected`).
- **Revision may be negotiated per connection.** The Node-RED wrapper offers
  "auto negotiation of revision" or a custom revision per MID
  ([node-red-contrib-open-protocol](https://github.com/st-one-io/node-red-contrib-open-protocol)),
  which suggests controllers differ in which revisions they accept. How a
  controller refuses an unsupported revision (presumably `0004` with an error
  code) is **not verified here**. Either way the revision may only be known at
  runtime, while the capture asks for revision-level types.
- **Cumulative layouts.** OpenProtocolInterpreter's model (a field appears from
  a revision on) implies each rev N type is a superset of rev N-1. Not
  verified here against the specification for every MID. Some MIDs may change
  field meaning rather than only append.
- **Header limits stay.** `Header.ts` rejects non-zero sequence number and
  message-parts fields (`UnsupportedFeature`). Multi-part messages remain out
  of reach unless the header work is reopened.
- **Specification licence.** The README cites the Atlas Copco specification
  (R2.8.0) rather than copying it. Field tables for new MIDs must be written
  from the specification in our own words, not pasted.
- **Repo law.** Schema-first domain models, typed errors, and
  `Context.Service` (CLAUDE.md, `standards/effect-first-development.md`).
  "Dynamically" must still land as schemas, not as runtime string maps.

## Questions Raised For Align

1. What "dynamically" means: user-land definitions registered at
   `DeviceConnection` / layer construction (compile-time types, open
   registry), or definitions loaded at runtime from data (no static types)?
2. Revision typing: one type per revision (a union discriminated by
   `revision`), or one type with fields that become optional depending on the
   revision?
3. Who picks the revision on send: the caller, per-connection negotiation, or
   the highest revision the definition supports?
4. Reply typing: does a definition declare its reply (`reply: Mid0002` or
   `reply: "accepted"`), à la `Rpc.make({ success })`? And do custom MIDs
   feed the same `request` API?
5. Do the built-in MIDs migrate onto the new definition mechanism (so
   `wireFormat`, `dataOf` and the hand-rolled slot codec disappear), or does it
   sit beside them?
6. Does the simulator need to answer custom MIDs?
7. Field codec surface: a Schema per field with annotations (`parameterId`,
   `width`, `since`), or a DSL of field constructors that produces Schemas?
