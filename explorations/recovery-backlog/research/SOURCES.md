# Recovery backlog — Sources & Provenance

- **Cluster / origin:** a chaos-run investigation on 2026-09-19 (see
  [CAPTURE.md](../CAPTURE.md)) plus one spec lookup.
- **Provenance:** [RESEARCH.md](../RESEARCH.md).

## 3. External citations

| Claim | Source | Notes |
| --- | --- | --- |
| MID 0004 code 15 = "Tightening ID requested not found", 79 = "Command failed" | [pkg.go.dev/github.com/rlz-buro/mid](https://pkg.go.dev/github.com/rlz-buro/mid) | Reference for numeric values only; no code taken. License not checked, so reference only. |
| MID 0064/0065 definitions | [Open Protocol Specification R2.8.0](https://s3.amazonaws.com/co.tulip.cdn/OpenProtocolSpecification_R280.pdf) | Atlas Copco specification. |

## 4. Upstream repos and licenses

None vendored or ported.

## 5. In-repo bricks

| Brick | Path | Role |
| --- | --- | --- |
| `runRecovery` | `packages/open-protocol/src/results/ResultRecovery.ts` | One recovery pass |
| `GapRecovery` | `packages/open-protocol/src/connection/GapRecovery.ts` | Pass policy per device |
| `Dedup` | `packages/open-protocol/src/results/Dedup.ts` | Seen window and watermark |
| `RequestReply` | `packages/open-protocol/src/connection/RequestReply.ts` | Reply correlation |
| Chaos demo | `packages/cli/src/chaos.ts` | Acceptance run |
