# Wire-trace CLI, sources and provenance

<!--
The provenance ledger for this packet. Start it in the `research` stage and keep
it current through graduate; the graduated goal inherits a copy. Purpose: let an
implementing agent trace every decision back to its origin — a mined source
(repo + file:line), an upstream repo + LICENSE, an external citation, or an
in-repo brick.

RULES
- Never fabricate a URL/DOI/repo link. Reproduce only sources that actually
  appear on disk in RESEARCH.md / research/*.md; if a claim has no on-disk URL,
  cite the RESEARCH.md section that carries it instead.
- Licenses are load-bearing: copyleft (AGPL/GPL/MPL) upstream is CLEAN-ROOM
  reimplement only (pattern, not vendored code); permissive (MIT/Apache/BSD) may
  be ported WITH attribution; missing/unverified LICENSE ⇒ treat as reference
  only. State the discipline per repo.
- Register this file in ops/manifest.json `exploration.sources`.
- Drop a section that genuinely does not apply (e.g. §1/§2 for a greenfield idea
  with no mined corpus) — but keep §3–§5.
-->

- **Cluster and origin:** the research sweep of 2026-09-18. Three web searches,
  covering latency injection, the Effect v4 CLI, and Open Protocol tooling,
  plus a targeted in-repo inventory of `src/**`, `simulator/**`, `demo/**` and
  `test/**`.
- **Provenance:** this packet's [`RESEARCH.md`](../RESEARCH.md). No mined code
  corpus, and no upstream repo is vendored or ported, so sections 1 and 2 are
  dropped per the rules above.

## 3. External research sources

| Source | Title | Used for | Discipline |
|--------|-------|----------|------------|
| [open-protocol-tester.software.informer.com](https://open-protocol-tester.software.informer.com/) | Open Protocol Tester (Atlas Copco Industrial Technique AB) | Prior art for the product shape: timestamped, filterable, exportable MID trace sessions | Reference only. Proprietary vendor tool, no code and no license to inherit |
| [github.com/Shopify/toxiproxy](https://github.com/Shopify/toxiproxy) | Toxiproxy, a TCP proxy to simulate network and system conditions | Out-of-process latency family: latency toxic with delay and jitter, bandwidth, timeout, slow close, reset | Reference only. Upstream LICENSE was not verified in this sweep, so treat as pattern and never vendor |
| [qaskills.sh, Toxiproxy fault injection guide (2026)](https://qaskills.sh/blog/toxiproxy-fault-injection-testing-guide-2026) | Toxiproxy Fault Injection: Simulate Network Failures in Tests | Toxic catalogue and CI integration shape | Reference only |
| [grokipedia.com/page/Toxiproxy](https://grokipedia.com/page/Toxiproxy) | Toxiproxy overview | The claim that a real proxy exercises real networking and pooling code | Reference only |
| [man7.org, tc-netem(8)](https://man7.org/linux/man-pages/man8/tc-netem.8.html) | Linux manual page for the netem qdisc | OS-level shaping: delay, jitter, loss, reordering | Reference only |
| [oneuptime.com, simulate network latency with tc netem](https://oneuptime.com/blog/post/2026-03-20-simulate-network-latency-tc-netem/view) | How to Simulate Network Latency with tc netem | Loopback example, `tc qdisc add dev lo root netem delay 600ms` | Reference only |
| [developers.redhat.com, simulate network latency in local containers](https://developers.redhat.com/articles/2025/05/26/how-simulate-network-latency-local-containers) | How to simulate network latency in local containers | The `NET_ADMIN` requirement and the egress-only limitation | Reference only |
| [effect.solutions/cli](https://www.effect.solutions/cli) | Command-Line Interfaces, Effect Solutions | The `effect/unstable/cli` surface: `Command`, `Flag`, `Argument`, `Primitive`, `Prompt`, `GlobalFlag`, shared `Param` combinators, and the flags-before-arguments rule | Reference only, documentation |
| [github.com/Effect-TS/effect-smol, ai-docs/src/70_cli/10_basics.ts](https://github.com/Effect-TS/effect-smol/blob/main/ai-docs/src/70_cli/10_basics.ts) | Effect v4 CLI basics example | Confirms the v4 CLI lives in core and replaces `@effect/cli` | Reference only. Upstream is the framework the repo already depends on |

One claim has no on-disk URL. The Open Protocol specification subset this repo
implements is described in the repo's own words in `README.md`, under "The
protocol subset", citing Atlas Copco Open Protocol R2.8.0. It is not reproduced
here.

## 4. In-repo capability references

| Brick | Path | Disposition |
|-------|------|-------------|
| CLI framework usage pattern: `Command`, `Flag`, `Command.run`, `NodeRuntime.runMain`, `NodeServices.layer` | `demo/chaos.ts` | reuse |
| Script wiring convention | `package.json`, `scripts.demo` | extend with two new scripts |
| TCP controller server | `simulator/ControllerSimulator.ts`, `makeTcp` and `makeWith` | reuse |
| Controller reply behaviour and identity | `simulator/ControllerBehaviour.ts` | reuse |
| Controller session state | `simulator/SessionState.ts` | reuse |
| Fault-injecting writer, controller side only | `simulator/FaultyWire.ts` | reuse |
| Seeded fault catalogue, including `delayReply` | `simulator/Faults.ts` | reuse, and extend for symmetric latency |
| Supervised client connection | `src/connection/DeviceConnection.ts` | reuse |
| Client config and defaults | `src/connection/DeviceSettings.ts` | reuse |
| Real-socket transport | `src/transport/TcpTransport.ts` | reuse |
| Byte-level seam for tracing and latency | `src/transport/Transport.ts`, `Duplex` | extend with a decorating `Duplex` |
| Codec for rendering a frame | `src/protocol/Messages.ts`, `src/protocol/Framer.ts`, `src/protocol/Header.ts` | reuse |
| Multi-device supervision, if the client CLI ever grows past one device | `src/pool/DevicePool.ts` | reuse |
| Both sides over a real socket, end to end | `test/integration/Tcp.test.ts` | reference |
| Raw wire trace: timestamped, direction-prefixed, control characters escaped | none | NET-NEW, see `RESEARCH.md`, Gaps 1 |
| Client-side and symmetric link latency | none | NET-NEW, see `RESEARCH.md`, Gaps 2 |
| Long-running controller-only and client-only commands | none | NET-NEW, see `RESEARCH.md`, Gaps 3 and 4 |

## 5. Cross-links and provenance

- This packet: [`README.md`](../README.md), [`CAPTURE.md`](../CAPTURE.md),
  [`RESEARCH.md`](../RESEARCH.md), [`DECISIONS.md`](../DECISIONS.md),
  [`BRIEF.md`](../BRIEF.md), [`ops/manifest.json`](../ops/manifest.json).
- Sibling packet:
  [`explorations/effect-open-protocol/`](../../effect-open-protocol/), the
  graduated exploration that produced the library these commands drive.
- Goal packets: none yet. They get registered in `ops/manifest.json`
  `links.goals` on graduation.
