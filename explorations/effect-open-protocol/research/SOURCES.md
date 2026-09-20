# Effect Open Protocol — Sources & Provenance

- **Cluster / origin:** the user's stated requirements (digested in
  [`../CAPTURE.md`](../CAPTURE.md) 2026-09-17) + research sweep 2026-09-17.
- **Provenance:** [`../RESEARCH.md`](../RESEARCH.md),
  [`../DECISIONS.md`](../DECISIONS.md).

## 1. Mined source corpus

| Source | Title | Upstream | Location | Theme | Disposition |
|--------|-------|----------|----------|-------|-------------|
| `effect-socket` | Socket service | Effect-TS/effect v4 | `.repos/effect/packages/effect/src/unstable/socket/Socket.ts:57` | transport | reuse (dependency) |
| `node-socket` | NodeSocket / NodeSocketServer | Effect-TS/effect v4 | `.repos/effect/packages/platform/node-shared/src/NodeSocket.ts:90` | TCP | reuse (dependency) |
| `effect-cli` | unstable/cli | Effect-TS/effect v4 | `.repos/effect/packages/effect/src/unstable/cli/` | demo CLI | reuse (dependency) |
| `effect-schedule` | Schedule | Effect-TS/effect v4 | `.repos/effect/packages/effect/src/Schedule.ts:850` | backoff | reuse (dependency) |
| `vitest-prop` | it.prop | Effect-TS/effect v4 | `.repos/effect/packages/vitest/src/index.ts:265` | property tests | reuse (dependency) |

## 2. Upstream repositories & licenses

| Repo | License | Port discipline | What we take |
|------|---------|-----------------|--------------|
| Effect-TS/effect (`.repos/effect`) | MIT (`.repos/effect/LICENSE`) | dependency; port-with-attribution if copying snippets | runtime primitives |
| Atlas Copco Open Protocol spec | proprietary (Atlas Copco) | reference-only; own-words description, cite | message layout facts |
| Author's NestJS service | private | not used; porting is forbidden | domain knowledge via user only |
| rolldown/tsdown | not verified | dependency only | build |

## 3. External research sources

- tsdown: https://tsdown.dev/ , https://tsdown.dev/guide/ , https://tsdown.dev/guide/getting-started , https://github.com/rolldown/tsdown
- Open Protocol Specification R2.8.0: https://s3.amazonaws.com/co.tulip.cdn/OpenProtocolSpecification_R280.pdf
- Open Protocol Specification (ServAid): https://servaid.atlascopco.com/AssertWeb/en-US/AtlasCopco/Document/10268853/GetFile
- Python Open Protocol client article: https://www.pensare.io/articles/building-a-python-client-for-atlas-copco-open-protocol-torque-tools/
- Open Protocol on Allen-Bradley: https://industrialmonitordirect.com/blogs/knowledgebase/implementing-atlas-copco-open-protocol-on-allen-bradley

## 4. In-repo capability references

No `src/` yet. Every library module (codec, connection, delivery, pool,
transport adapters, simulator, demo) is NET-NEW, composed from Effect v4
bricks listed in `RESEARCH.md` → In-Repo Capability Inventory.

## 5. Cross-links & provenance

- Exploration: `explorations/effect-open-protocol/` (this packet).
- Goals: [`goals/effect-open-protocol`](../../../goals/effect-open-protocol/README.md) (graduated 2026-09-17).
