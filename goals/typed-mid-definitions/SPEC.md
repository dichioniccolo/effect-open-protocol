# Typed MID Definitions Spec

## Objective

Anyone can define an Open Protocol MID in their own code, with one exact type
per revision and the reply it expects declared on the definition, all built on
Effect Schema.

`connection.request(Definition.rev(n), payload)` returns an Effect whose
success type is exactly the reply that revision declares. Every built-in MID
(0001–0005, 0060–0065, 9999) is defined the same way, and the hand-written
codec and the untyped request API are gone.

Shipped as a pull request driven to mergeable.

Source exploration: [`explorations/typed-mids/`](../../explorations/typed-mids/).
The shaped pitch is [`BRIEF.md`](../../explorations/typed-mids/BRIEF.md), the
decomposition is [`MAP.md`](../../explorations/typed-mids/MAP.md), and every
decision below is recorded with its rejected alternatives in
[`DECISIONS.md`](../../explorations/typed-mids/DECISIONS.md).

## Non-Goals

Carried from the brief's no-gos, plus the boundary with the follow-on goal.

- **Typed subscriptions** belong to the follow-on goal
  [`typed-subscriptions`](../typed-subscriptions/). That covers `subscribe`,
  consumer acks, restoring subscriptions after a reconnect, and rebuilding
  `ResultDelivery` on them. Here, pushed custom MIDs still arrive as
  `UnknownMessage`, and the built-in 0061 push path keeps today's behaviour.
- Definitions loaded from data at runtime (JSON, config). Only code-defined,
  statically typed definitions.
- Revision negotiation, or a per-connection revision config. The caller picks
  the revision.
- A MID catalogue. Beyond the migrated built-ins, only one example custom MID.
- Simulator handlers for custom MIDs. The simulator answers `0004`.
- Generic dedup.
- Keeping the old `request(message, mid, direct?)` API, or a deprecation
  window.
- Multi-part messages, the header `noAck` flag, and station/spindle other than
  `1`.
- Changes to `packages/store`, `packages/cli` or `apps/ui` beyond keeping them
  compiling. They read headers and raw frames only.

## Source Hierarchy

1. User objective or issue that created this packet.
2. `CLAUDE.md` and required skills (`effect-first-development`,
   `schema-first-development`, `.patterns/jsdoc-documentation.md`).
3. Governing standards (`standards/`, `.patterns/`).
4. This `SPEC.md`.
5. `PLAN.md`.
6. `GOAL.md`.
7. Supporting `research/`, `ops/`, and `history/` files.

Higher sources outrank lower sources when they conflict.

## Target Surfaces

All paths are under `packages/open-protocol/`.

- `src/protocol/`:
  - A new public field-codec module (`Field.*`).
  - A new public MID-definition module.
  - `Messages.ts` rebuilt on definitions.
  - `TighteningResult.ts` loses its private slot codec.
  - `Ascii.ts`, `Header.ts` and `ProtocolError.ts` reused.
- `src/connection/`:
  - `RequestReply.ts` becomes typed.
  - The `request` surface in `DeviceConnection.ts`.
  - The call sites in `Handshake.ts`, `Session.ts` (keep-alive and decode
    fallback) and `GapRecovery.ts`.
  - `ConnectionError.ts` gains `UnexpectedRevision` (working name).
- `src/results/ResultRecovery.ts`: its request call site.
- `src/index.ts`: re-exports.
- `simulator/ControllerBehaviour.ts`: answer `0004` for MIDs it does not
  model.
- `test/`: new tests plus migrated call sites.
- `README.md` (package and root): a section for defining a MID and the new
  request API.
- `packages/cli` and `apps/ui`: only what the API break forces.

## Constraints

Rabbit holes from the brief, carried here as hard constraints.

- **Exact types are the point.** A revision's type has exactly that revision's
  fields, and a request's reply type is exactly the declared reply revision.
  Pin them with `expectTypeOf` tests: one multi-revision MID, 0064 → 0065, and
  an `accepted` reply. If type-level cost sprawls, cut in this order:
  1. The cumulative `extend` helper (revisions written out in full).
  2. Mapped reply revisions collapse to "same revision" for the built-ins.

  Never cut exactness.
- **Layouts are ordered.** A layout is an array (or an ordered tuple of named
  fields), never a plain record. Wire order must not depend on object key
  order.
- **0061/0065 are the acceptance test.** Parameter IDs, filler fields and
  enum-coded digits (`TighteningStatus`, `LimitStatus`) must encode and decode
  through `Field.*`. The property round trips at
  `test/protocol/Messages.test.ts:159,176` pass without their assertions
  changing.
- **The request slot is unchanged.** Still one outstanding request, no
  correlation ID, and a one-permit semaphore (`RequestReply.ts`). Frames are
  still offered to `RequestReply` first (`Session.ts:66`).
- **Replies:**
  - `accepted` replies (0005/0004) match by MID only; 0004 stays
    `CommandRejected`.
  - Revision checks apply to dedicated replies.
  - A dedicated reply at an undefined revision fails the pending request at
    once with `UnexpectedRevision`, not a timeout.
- **Decode fallback is body-only.**
  - A body that fails to decode, or a revision the definition doesn't define,
    becomes `UnknownMessage { mid, revision, data }` plus a warning log
    carrying the MID, revision and reason. The session survives.
  - Framing and header errors (`MalformedHeader`, `UnsupportedFeature`) still
    end the session as today (`Session.ts:78`).
- **Encoding takes the revision from the value.** The hard-coded `revisionOf`
  (always 1) goes away.
- **Field tables are our own words.** New layouts, the example custom MID
  included, are written from the Open Protocol specification in our own
  words, never pasted. If the example MID's layout can't be confirmed from the
  specification, label it clearly as illustrative in the tests and README.
- **Repo laws apply.**
  - Schema-first models, typed errors, Effect helper modules over native
    helpers.
  - The anti-slop lint rules (`.oxlintrc.json`).
  - The JSDoc rubric on every new export.
- **No new dependencies.**

## Decisions

Full rationale and rejected options live in the exploration's
[`DECISIONS.md`](../../explorations/typed-mids/DECISIONS.md). Summary:

| Decision | Choice |
| --- | --- |
| Meaning of "dynamic" | Code-defined definitions, open registry, statically typed |
| Revision typing | One Schema per revision, a union discriminated by `revision`. Cumulative by default, and a revision may override its layout |
| Revision on send | The caller picks it, per request |
| Reply declaration | On the definition: another definition at a revision, `accepted`, or none |
| Reply revision | Mapped per request revision, checked at compile time |
| Field layout | `Field.*` constructors that return Schemas with typed annotations |
| Built-ins | All migrate. `wireFormat`, `dataOf` and the slot codec are removed |
| Undefined revision / body decode failure | `UnknownMessage` plus a warning. The session survives, and a pending request gets `UnexpectedRevision` |
| Simulator | Answers `0004` for MIDs it doesn't model, with no custom handlers |
| Old `request` API | Removed outright |
| Inherited limits | One request at a time, `noAck` false, station/spindle 1, no multi-part |

One of these overrode the recommendation given during alignment: the
simulator answers `0004` rather than offering a handler hook.

## Acceptance Criteria

- [ ] A public `Field` module builds fixed-width fields as Schemas, with and
      without parameter IDs, including filler fields that are on the wire but
      not in the type. `TighteningResult.ts` no longer has a private slot
      codec.
- [ ] A public definition API declares:
      - a MID number;
      - one Schema per revision, whose decoded value carries a `revision`
        literal (cumulative by default, with per-revision override);
      - for request definitions, a reply per revision: definition at a
        revision, `accepted`, or none.
- [ ] Every built-in MID is a definition. `wireFormat`, `decoderFor`,
      `dataOf`, `midOf`, `revisionOf` and the closed `Mid` literal set are
      gone, and encoding writes the header revision from the value.
- [ ] `DeviceConnection.request(Definition.rev(n), payload)` returns the
      declared reply type, with `expectTypeOf` tests for a multi-revision
      MID, 0064 → 0065 and an `accepted` reply.
- [ ] `request(message, mid, direct?)` and `expectReply` are removed. The
      handshake, keep-alive, gap recovery and `ResultRecovery` use the typed
      call.
- [ ] Undefined revisions and body decode failures become `UnknownMessage`
      with a warning, and the session survives. A pending request whose
      dedicated reply arrives at an undefined revision fails with
      `UnexpectedRevision`. Each path has a test, and header errors still end
      the session.
- [ ] The simulator answers `0004` to a MID it doesn't model, with a test.
- [ ] One example custom MID, with at least two revisions and a declared reply,
      is covered by codec round-trip tests and by a typed request over the
      in-memory transport. The README shows how to define and request it.
- [ ] Every new export meets the JSDoc rubric.
- [ ] Every existing suite passes, with changes only to call sites the API
      break forces.
- [ ] Shipped as a PR driven to mergeable.
- [ ] No unrelated refactors or formatting churn.

## Verification Matrix

| Check | Command or evidence | Required result |
| --- | --- | --- |
| Type check | `bun run check` | Passes |
| Tests | `bun run test` | Passes |
| Lint | `bun run lint` | Passes |
| Format | `bun run format:check` | Passes |
| Build | `bun run build` | Passes (tsdown and `next build`) |
| Exact types | `expectTypeOf` tests named in Acceptance | Pass |
| Packet launcher size | `test "$(wc -m < goals/typed-mid-definitions/GOAL.md)" -le 4000` | Passes |
| Manifest JSON | `jq . goals/typed-mid-definitions/ops/manifest.json` | Passes |
| Whitespace | `git diff --check -- goals/typed-mid-definitions` | Passes |
| PR | `gh pr view --json mergeStateStatus` | `CLEAN`, zero unresolved threads |

## Stop Conditions

- Required source files are missing or materially contradictory.
- The implementation would exceed named scope. Subscriptions belong to
  `typed-subscriptions`.
- Verification requires credentials, cost, destructive side effects, or policy
  approval not named in this spec.
- The same blocker repeats after reasonable investigation.
- Exact revision or reply types prove impossible even after both appetite cuts:
  stop and report with the failing type test. Do not widen the types.
- An existing delivery, chaos or gap-recovery assertion would have to change
  (not just its call site): stop and report.

## Exception Ledger

| Exception | Scope | Owner | Rationale | Removal condition |
| --- | --- | --- | --- | --- |
| Breaking public API | `DeviceConnection.request`, `expectReply`, `Mid`, `Message` shape | This goal | Decided in `break-request-api`: the package is `0.0.0` and private | None; intended |
