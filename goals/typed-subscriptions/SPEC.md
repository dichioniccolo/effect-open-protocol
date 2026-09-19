# Typed Subscriptions Spec

## Objective

A subscribed MID arrives typed.

`connection.subscribe(Subscription.rev(n))` returns a `Stream` of
`{ value, ack }`:
- `value` is exactly the data MID's type at the declared revision.
- The consumer runs `ack` once it has handled the value.
- The subscription is restored after every reconnect, and the stream lives
  until the consumer stops or the connection closes.

The built-in tightening-result path runs on the same primitive:
`ResultDelivery` consumes `subscribe(LastResults)` and keeps dedup, gap
recovery and ack-after-handler exactly as today.

Shipped as a pull request driven to mergeable.

Source exploration: [`explorations/typed-mids/`](../../explorations/typed-mids/).
The shaped pitch is [`BRIEF.md`](../../explorations/typed-mids/BRIEF.md), the
decomposition is [`MAP.md`](../../explorations/typed-mids/MAP.md), and every
decision below is recorded with its rejected alternatives in
[`DECISIONS.md`](../../explorations/typed-mids/DECISIONS.md).

**Prerequisite:** [`typed-mid-definitions`](../typed-mid-definitions/) merged.
This goal builds on its definitions, codec and typed `request`.

## Non-Goals

- Generic dedup in `subscribe`. Consumers stay idempotent, and dedup remains
  `ResultDelivery`'s job (keyed by `tighteningId`).
- Auto-ack on receipt, or a handler-based `subscribe(def, handler)`.
- A stream that fails on a dropped connection and makes the consumer
  re-subscribe.
- Simulator handlers for custom subscriptions. The simulator answers `0004`,
  per `typed-mid-definitions`.
- Anything `typed-mid-definitions` already excludes: runtime-loaded
  definitions, revision negotiation, a MID catalogue, multi-part messages,
  `noAck`.
- Changes to delivery semantics. Ack only after the handler succeeds, dedup
  and gap recovery behave exactly as today.

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

- The definition module from `typed-mid-definitions` gains subscription
  definitions (subscribe, data, ack and unsubscribe MIDs).
- `src/connection/DeviceConnection.ts`:
  - `subscribe` on the service;
  - a registry of active subscriptions;
  - `routeUnsolicited` (`:215-224`) and the ack send (`:184`) replaced by it.
- `src/connection/Handshake.ts`: re-subscribe every active subscription after
  the handshake (today only 0060, at `:49`).
- `src/connection/Session.ts`: keep offering to `RequestReply` first (`:66`),
  then to subscriptions.
- `src/results/ResultDelivery.ts` and `src/results/ResultRecovery.ts`: consume
  `subscribe(LastResults)`.
- `src/index.ts`: re-exports.
- `test/` and `README.md` (delivery semantics and subscribing).

## Constraints

- **Delivery guarantees are sacred.** The Delivery, Chaos, GapRecovery and
  Shutdown suites pass without their assertions changing. `ResultDelivery`
  moves onto `subscribe` **last**, after `subscribe` is proven on the example
  custom MID.
- **Frame routing order stays.** A frame goes to `RequestReply` first, then to
  subscriptions. A pushed 0061 can arrive while 0064 waits for 0065.
- **Acks stay out of the request slot.** `ack` is a plain send, never a
  request, so it can't block on or be blocked by a pending request.
- **The registry is its own structure.** The subscription registry is not
  `RequestReply`'s one-request slot: subscriptions are many and long-lived
  (MAP capability check). It shares only the "offer, then fall through"
  dispatch shape.
- **Unsubscribed frames are unchanged.** Frames for MIDs with no active
  subscription behave as `typed-mid-definitions` leaves them: `UnknownMessage`,
  or the body decode fallback.
- **Unacked values keep today's behaviour.** A value never acked is resent by
  the controller, and nothing in the library dedups it for custom MIDs.
- **Repo laws apply.**
  - Schema-first models, typed errors, Effect helper modules.
  - The anti-slop lint rules.
  - The JSDoc rubric on every new export.
- **No new dependencies.**

## Decisions

Full rationale and rejected options live in the exploration's
[`DECISIONS.md`](../../explorations/typed-mids/DECISIONS.md). Summary:

| Decision | Choice |
| --- | --- |
| Pushed MIDs | `subscribe(definition)` returns a typed Stream, and a registry of active subscriptions drives decoding |
| Push ack | The definition declares its ack MID, and each element carries an `ack` Effect the consumer runs |
| Reconnect | Subscriptions are re-sent after every handshake, and the stream lives on |
| Built-in results | `ResultDelivery` is rebuilt on `subscribe(LastResults)` |
| Dedup | None in `subscribe`; it stays in `ResultDelivery` |

## Acceptance Criteria

- [ ] A subscription definition declares its subscribe, data, ack and
      unsubscribe MIDs (ack and unsubscribe optional where the protocol has
      none).
- [ ] `DeviceConnection.subscribe(Sub.rev(n))` returns
      `Stream<{ value, ack }>` with `value` typed exactly, pinned by
      `expectTypeOf`.
- [ ] Frames for active subscriptions decode typed, and every other frame
      keeps its `typed-mid-definitions` behaviour.
- [ ] Running `ack` sends the ack MID. A test shows an unacked value being
      resent.
- [ ] After a reconnect, active subscriptions are re-sent and the same stream
      keeps emitting. Stopping the stream sends the unsubscribe MID (where
      defined) and removes the registry entry. Each is tested.
- [ ] The example custom MID from `typed-mid-definitions` gains a subscription
      tested over the in-memory transport.
- [ ] `ResultDelivery` consumes `subscribe(LastResults)`, and the old
      `routeUnsolicited` `LastResult` branch and the direct ack send are gone.
      Unsolicited 0065 handling is kept, or moved with it, with no behaviour
      change.
- [ ] The Delivery, Chaos, GapRecovery and Shutdown suites pass with
      assertions unchanged.
- [ ] The README covers subscribing and updates §Delivery semantics. Every new
      export meets the JSDoc rubric.
- [ ] Shipped as a PR driven to mergeable.
- [ ] No unrelated refactors or formatting churn.

## Verification Matrix

| Check | Command or evidence | Required result |
| --- | --- | --- |
| Type check | `bun run check` | Passes |
| Tests | `bun run test` | Passes |
| Lint | `bun run lint` | Passes |
| Format | `bun run format:check` | Passes |
| Build | `bun run build` | Passes |
| Delivery guarantees | `bunx --bun vitest run packages/open-protocol/test/integration packages/open-protocol/test/connection` | Pass with assertions unchanged |
| Packet launcher size | `test "$(wc -m < goals/typed-subscriptions/GOAL.md)" -le 4000` | Passes |
| Manifest JSON | `jq . goals/typed-subscriptions/ops/manifest.json` | Passes |
| Whitespace | `git diff --check -- goals/typed-subscriptions` | Passes |
| PR | `gh pr view --json mergeStateStatus` | `CLEAN`, zero unresolved threads |

## Stop Conditions

- `typed-mid-definitions` is not merged: stop, since this goal is paused until
  it is.
- Required source files are missing or materially contradictory.
- The implementation would exceed named scope.
- Verification requires credentials, cost, destructive side effects, or policy
  approval not named in this spec.
- The same blocker repeats after reasonable investigation.
- A delivery, chaos, gap-recovery or shutdown assertion would have to change:
  stop and report. Do not weaken the guarantee to fit the primitive.

## Exception Ledger

| Exception | Scope | Owner | Rationale | Removal condition |
| --- | --- | --- | --- | --- |
| None | N/A | N/A | N/A | N/A |
