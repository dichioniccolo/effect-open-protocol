# Effect Open Protocol — Sources & Provenance

- **Source exploration:** `explorations/effect-open-protocol` — primary ledger:
  [`explorations/effect-open-protocol/research/SOURCES.md`](../../../explorations/effect-open-protocol/research/SOURCES.md).
  Reproduced below for implementation convenience; the exploration copy wins on conflict.
- **Provenance:** [`RESEARCH.md`](../../../explorations/effect-open-protocol/RESEARCH.md),
  [`DECISIONS.md`](../../../explorations/effect-open-protocol/DECISIONS.md).

## 1. Mined source corpus


| Source | Title | Upstream | Location | Theme | Disposition |
|--------|-------|----------|----------|-------|-------------|
| `plan-00..10` | openprotocol-effect-plan | user-local, not in repo | `/mnt/d/Users/nicky/Downloads/openprotocol-effect-plan/openprotocol-effect-plan/*.md` | full product plan | authoritative intent; digested in `CAPTURE.md` |
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
| Author's NestJS service | private | not used; the plan forbids porting | domain knowledge via user only |
| rolldown/tsdown | not verified | dependency only | build |

## 3. External research sources

- tsdown, https://tsdown.dev/ , https://tsdown.dev/guide/ , https://tsdown.dev/guide/getting-started , https://github.com/rolldown/tsdown
- Open Protocol Specification R2.8.0, https://s3.amazonaws.com/co.tulip.cdn/OpenProtocolSpecification_R280.pdf
- Open Protocol Specification (ServAid), https://servaid.atlascopco.com/AssertWeb/en-US/AtlasCopco/Document/10268853/GetFile
- Python Open Protocol client article, https://www.pensare.io/articles/building-a-python-client-for-atlas-copco-open-protocol-torque-tools/
- Open Protocol on Allen-Bradley, https://industrialmonitordirect.com/blogs/knowledgebase/implementing-atlas-copco-open-protocol-on-allen-bradley

## 4. In-repo capability references

No `src/` yet. Every library module (codec, connection, delivery, pool,
transport adapters, simulator, demo) is NET-NEW, composed from Effect v4
bricks listed in `RESEARCH.md` → In-Repo Capability Inventory.

## 5. Cross-links & provenance

- Source exploration: `explorations/effect-open-protocol` (`links.goals` → this packet).
- SPEC decision log: [`../SPEC.md`](../SPEC.md) → Decision Log.
