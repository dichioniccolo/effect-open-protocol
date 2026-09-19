# Typed MIDs — Sources & Provenance

- **Cluster / origin:** research sweep of 2026-09-19. Web search and fetch of
  Open Protocol libraries, the linked Effect v4 source at
  `.repos/effect@9ad9891e24`, and a read of `packages/open-protocol`.
- **Provenance:** [`../RESEARCH.md`](../RESEARCH.md) carries every claim below.

## 1. Mined source corpus

| Source | Title | Upstream (repo) | Location (`file:line`) | Theme | Disposition |
|--------|-------|-----------------|------------------------|-------|-------------|
| `opi-mid0002` | MID 0002 with 8 cumulative revisions | Rickedb/OpenProtocolInterpreter | `src/OpenProtocolInterpreter/Communication/Mid0002.cs` | fields tagged with the revision that introduced them | port-with-attribution (pattern) |
| `opi-readme` | Custom MID registration, `GetAcknowledge()` / `GetReply()` | Rickedb/OpenProtocolInterpreter | `README.md` | open registry, reply as a method | port-with-attribution (pattern) |
| `nop-readme` | One file per MID, raw `sendMid()` | st-one-io/node-open-protocol | `README.md` | per-MID module layout | clean-room (reference) |
| `effect-annotations` | Custom `Annotations` augmentation | Effect-TS/effect | `packages/effect/src/Schema.ts:15005-15050` | field metadata on schemas | reuse (dependency) |
| `effect-rpc-make` | `Rpc.make(tag, { payload, success, error })` | Effect-TS/effect | `packages/effect/src/unstable/rpc/Rpc.ts:902-935` | request definition carries the reply type | reuse pattern (dependency) |
| `effect-template-literal-parser` | `TemplateLiteralParser` round-trip gotcha | Effect-TS/effect | `packages/effect/src/Schema.ts:2797-2850` | why separator parsing doesn't fit | reference |

**How these inform this packet:**
- Data model: OpenProtocolInterpreter's per-field `revision` attribute, turned
  into a typed Schema annotation (`since`) rather than reflection.
- Reply typing: `Rpc.make`'s `success` / `error` schemas on the request
  definition, applied to a MID definition's `reply`.
- Registry: OpenProtocolInterpreter's `UseCustomMessage` MID → type map as the
  runtime shape. The repo's `satisfies`-checked `wireFormat` shows how to keep
  it typed.

## 2. Upstream repositories & licenses

| Repo | License | Port discipline | What we take |
|------|---------|-----------------|--------------|
| [Rickedb/OpenProtocolInterpreter](https://github.com/Rickedb/OpenProtocolInterpreter) | MIT (per README fetch) | port-with-attribution | Revision-per-field model, open MID registry, reply accessor idea. No code. |
| [st-one-io/node-open-protocol](https://github.com/st-one-io/node-open-protocol) | GPL-3.0 | clean-room only | Per-MID file layout as an idea. Nothing copied. |
| [st-one-io/node-red-contrib-open-protocol](https://github.com/st-one-io/node-red-contrib-open-protocol) | unverified | reference only | Existence of per-MID revision selection and auto-negotiation. |
| [Wahlengm/Atlas-Copco-Open-Protocol](https://github.com/Wahlengm/Atlas-Copco-Open-Protocol) | unverified | reference only | Not inspected. |
| [YangWenLong1222/openprotocol](https://github.com/YangWenLong1222/openprotocol) | unverified | reference only | Not inspected. |
| [MicroFocus/sv-ops2sd](https://github.com/MicroFocus/sv-ops2sd) | unverified | reference only | Idea: MID layouts as data. |
| [ianlopshire/go-fixedwidth](https://github.com/ianlopshire/go-fixedwidth) | unverified | reference only | Idea: position/width/alignment/padding per field. |
| Effect-TS/effect (`.repos/effect`) | MIT (verified, `.repos/effect/LICENSE`) | dependency | Schema, SchemaTransformation, annotations, Rpc pattern. |

## 3. External research sources

- <https://github.com/Rickedb/OpenProtocolInterpreter> — RESEARCH.md §External Landscape
- <https://github.com/Rickedb/OpenProtocolInterpreter/blob/master/src/OpenProtocolInterpreter/Communication/Mid0002.cs>
- <https://github.com/st-one-io/node-open-protocol>
- <https://github.com/st-one-io/node-red-contrib-open-protocol> — RESEARCH.md §Constraints Discovered
- <https://github.com/Wahlengm/Atlas-Copco-Open-Protocol>
- <https://github.com/YangWenLong1222/openprotocol>
- <https://github.com/MicroFocus/sv-ops2sd>
- <https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/SCHEMA.md>
- <https://github.com/ianlopshire/go-fixedwidth>

## 4. In-repo capability references

Paths under `packages/open-protocol/`.

| Module | Path | Mark |
|--------|------|------|
| MID literal set, message classes, `Message` union | `src/protocol/Messages.ts:36-238` | extend or replace |
| `wireFormat` registry, `decodeMessage`, `encodeMessage`, `dataOf` | `src/protocol/Messages.ts:314-439` | replace (the registry becomes open) |
| Header codec (revision field) | `src/protocol/Header.ts` | reuse |
| Slot codec (`id` + width parameters) | `src/protocol/TighteningResult.ts` | generalise into Schema field codecs |
| ASCII primitives | `src/protocol/Ascii.ts` | reuse |
| Protocol errors | `src/protocol/ProtocolError.ts` | reuse |
| Request/reply correlation | `src/connection/RequestReply.ts` | extend (typed reply) |
| Public `request` | `src/connection/DeviceConnection.ts:60-64,362` | extend (typed reply) |
| Simulator replies | `simulator/ControllerBehaviour.ts:112-156` | extend or leave |
| Revision-aware body layouts | — | NET-NEW |
| Schema fixed-width field codec | — | NET-NEW (generalised from the slot codec) |

## 5. Cross-links & provenance

- This packet: [`../RESEARCH.md`](../RESEARCH.md), [`../CAPTURE.md`](../CAPTURE.md).
- Sibling (graduated): [`../../effect-open-protocol/`](../../effect-open-protocol/),
  which shaped the original library and its MID subset (see its `BRIEF.md`).
