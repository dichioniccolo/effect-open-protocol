/**
 * The connection state machine, as data.
 *
 * Keeping transitions in a pure function means the interesting part of a
 * resilient connection — which failures lead where, and what is impossible —
 * is tested without sockets, timers or fibers.
 *
 * ```text
 * Disconnected ──AttemptStarted──► Connecting(1)
 * WaitingToReconnect ──AttemptStarted──► Connecting(n + 1)
 * Connecting ──Opened──► Handshaking       ──Failed──► WaitingToReconnect
 * Handshaking ──Accepted──► Subscribing    ──Failed──► WaitingToReconnect
 * Subscribing ──Subscribed──► Recovering   ──Failed──► WaitingToReconnect
 * Recovering ──Recovered──► Ready          ──Failed──► WaitingToReconnect
 * Ready ──Failed──► WaitingToReconnect
 * any non-final ──CloseRequested──► Closing ──Released──► Closed
 * ```
 *
 * @since 0.0.0
 */
import { Match, Predicate, Result } from "effect"
import * as S from "effect/Schema"

/**
 * Nothing is open yet and no attempt is running.
 *
 * @category models
 * @since 0.0.0
 */
export class Disconnected extends S.TaggedClass<Disconnected>()(
  "Disconnected",
  {},
  {
    description: "Idle, before the first connection attempt"
  }
) {}

/**
 * A transport connection is being opened.
 *
 * @category models
 * @since 0.0.0
 */
export class Connecting extends S.TaggedClass<Connecting>()(
  "Connecting",
  {
    attempt: S.Number.check(S.isInt(), S.isGreaterThanOrEqualTo(1))
  },
  { description: "Opening the transport connection" }
) {}

/**
 * The socket is open and the communication start exchange is in flight.
 *
 * @category models
 * @since 0.0.0
 */
export class Handshaking extends S.TaggedClass<Handshaking>()(
  "Handshaking",
  {
    attempt: S.Number.check(S.isInt(), S.isGreaterThanOrEqualTo(1))
  },
  { description: "Waiting for the controller to accept the session" }
) {}

/**
 * The session is open and subscriptions are being restored.
 *
 * @category models
 * @since 0.0.0
 */
export class Subscribing extends S.TaggedClass<Subscribing>()(
  "Subscribing",
  {
    attempt: S.Number.check(S.isInt(), S.isGreaterThanOrEqualTo(1)),
    controllerName: S.String
  },
  { description: "Restoring the tightening result subscription" }
) {}

/**
 * Results missed while the connection was down are being fetched.
 *
 * @category models
 * @since 0.0.0
 */
export class Recovering extends S.TaggedClass<Recovering>()(
  "Recovering",
  {
    attempt: S.Number.check(S.isInt(), S.isGreaterThanOrEqualTo(1)),
    controllerName: S.String
  },
  { description: "Fetching results missed during the outage" }
) {}

/**
 * The connection is live and carrying traffic.
 *
 * @category models
 * @since 0.0.0
 */
export class Ready extends S.TaggedClass<Ready>()(
  "Ready",
  {
    controllerName: S.String
  },
  { description: "Connected, subscribed and up to date" }
) {}

/**
 * The connection failed and the next attempt is scheduled.
 *
 * @category models
 * @since 0.0.0
 */
export class WaitingToReconnect extends S.TaggedClass<WaitingToReconnect>()(
  "WaitingToReconnect",
  {
    attempt: S.Number.check(S.isInt(), S.isGreaterThanOrEqualTo(1)),
    reason: S.String
  },
  { description: "Backing off before the next attempt" }
) {}

/**
 * The application asked to close; resources are being released.
 *
 * @category models
 * @since 0.0.0
 */
export class Closing extends S.TaggedClass<Closing>()(
  "Closing",
  {},
  {
    description: "Releasing the session, best effort communication stop"
  }
) {}

/**
 * Terminal state: the connection will never carry traffic again.
 *
 * @category models
 * @since 0.0.0
 */
export class Closed extends S.TaggedClass<Closed>()("Closed", {}, { description: "Terminal state" }) {}

/**
 * Every state a device connection can be in.
 *
 * @category models
 * @since 0.0.0
 */
export type ConnectionState =
  | Disconnected
  | Connecting
  | Handshaking
  | Subscribing
  | Recovering
  | Ready
  | WaitingToReconnect
  | Closing
  | Closed

/**
 * Something that happened to a connection.
 *
 * @category models
 * @since 0.0.0
 */
export type ConnectionEvent =
  | AttemptStarted
  | Opened
  | Accepted
  | Subscribed
  | Recovered
  | Failed
  | CloseRequested
  | Released

/**
 * A connection attempt began: the first one, or the one that follows a backoff.
 *
 * The distinction lives in the state, not in the caller: `Disconnected` starts
 * at attempt 1 and `WaitingToReconnect` continues its count.
 *
 * @category models
 * @since 0.0.0
 */
export class AttemptStarted extends S.TaggedClass<AttemptStarted>()(
  "AttemptStarted",
  {},
  {
    description: "A connection attempt began"
  }
) {}

/**
 * The transport connection is open.
 *
 * @category models
 * @since 0.0.0
 */
export class Opened extends S.TaggedClass<Opened>()(
  "Opened",
  {},
  {
    description: "The transport connection is open"
  }
) {}

/**
 * The controller accepted the session.
 *
 * @category models
 * @since 0.0.0
 */
export class Accepted extends S.TaggedClass<Accepted>()(
  "Accepted",
  {
    controllerName: S.String
  },
  { description: "The controller accepted the communication start" }
) {}

/**
 * Subscriptions were restored.
 *
 * @category models
 * @since 0.0.0
 */
export class Subscribed extends S.TaggedClass<Subscribed>()(
  "Subscribed",
  {},
  {
    description: "The tightening result subscription is active"
  }
) {}

/**
 * Gap recovery finished.
 *
 * @category models
 * @since 0.0.0
 */
export class Recovered extends S.TaggedClass<Recovered>()(
  "Recovered",
  {},
  {
    description: "Missed results were fetched"
  }
) {}

/**
 * The attempt or the live session failed.
 *
 * @category models
 * @since 0.0.0
 */
export class Failed extends S.TaggedClass<Failed>()(
  "Failed",
  {
    reason: S.String
  },
  { description: "The attempt or session failed" }
) {}

/**
 * The application asked to close the connection.
 *
 * @category models
 * @since 0.0.0
 */
export class CloseRequested extends S.TaggedClass<CloseRequested>()(
  "CloseRequested",
  {},
  {
    description: "close() was called"
  }
) {}

/**
 * Every resource of the connection was released.
 *
 * @category models
 * @since 0.0.0
 */
export class Released extends S.TaggedClass<Released>()(
  "Released",
  {},
  {
    description: "Resources were released"
  }
) {}

/**
 * A transition that the state machine forbids.
 *
 * Reaching one means the connection logic has a bug, so callers treat it as a
 * defect rather than an expected failure.
 *
 * @category errors
 * @since 0.0.0
 */
export class InvalidTransition extends S.TaggedError<InvalidTransition>()("InvalidTransition", {
  state: S.String,
  event: S.String
}) {}

/**
 * The state a connection starts in.
 *
 * @category constructors
 * @since 0.0.0
 */
export const initial: ConnectionState = new Disconnected()

/**
 * Whether the connection can still change state.
 *
 * @category predicates
 * @since 0.0.0
 */
export const isFinal = (state: ConnectionState): boolean => Predicate.isTagged(state, "Closed")

/**
 * Whether a close is already under way or done, so asking for one again has
 * nothing left to do.
 *
 * @category predicates
 * @since 0.0.0
 */
export const isClosedOrClosing = (state: ConnectionState): boolean =>
  isFinal(state) || Predicate.isTagged(state, "Closing")

/**
 * Whether the connection can carry application traffic.
 *
 * @category predicates
 * @since 0.0.0
 */
export const isReady = (state: ConnectionState): boolean => Predicate.isTagged(state, "Ready")

/** The result of applying one event: the next state, or why it was refused. */
type Transitioned = Result.Result<ConnectionState, InvalidTransition>

const moveTo = (state: ConnectionState): Transitioned => Result.succeed(state)

const invalid = (state: ConnectionState, event: ConnectionEvent): Transitioned =>
  Result.fail(new InvalidTransition({ state: state._tag, event: event._tag }))

/**
 * Applies an event to a state.
 *
 * Invalid pairs fail with `InvalidTransition` instead of silently doing
 * nothing, so a wrong wiring shows up immediately in tests.
 *
 * **Example** (Opening a connection)
 *
 * ```ts
 * import { AttemptStarted, initial, transition } from "effect-open-protocol"
 *
 * const next = transition(initial, new AttemptStarted())
 * ```
 *
 * @category transitions
 * @since 0.0.0
 */
export const transition = (state: ConnectionState, event: ConnectionEvent): Transitioned =>
  isFinal(state)
    ? invalid(state, event)
    : Match.value(event).pipe(
        Match.tag("CloseRequested", () => moveTo(new Closing())),
        Match.tag("Released", () =>
          Predicate.isTagged(state, "Closing") ? moveTo(new Closed()) : invalid(state, event)
        ),
        Match.tag("AttemptStarted", () =>
          Match.value(state).pipe(
            Match.tag("Disconnected", () => moveTo(new Connecting({ attempt: 1 }))),
            Match.tag("WaitingToReconnect", (waiting) => moveTo(new Connecting({ attempt: waiting.attempt + 1 }))),
            Match.orElse(() => invalid(state, event))
          )
        ),
        Match.tag("Opened", () =>
          Predicate.isTagged(state, "Connecting")
            ? moveTo(new Handshaking({ attempt: state.attempt }))
            : invalid(state, event)
        ),
        Match.tag("Accepted", (accepted) =>
          Predicate.isTagged(state, "Handshaking")
            ? moveTo(new Subscribing({ attempt: state.attempt, controllerName: accepted.controllerName }))
            : invalid(state, event)
        ),
        Match.tag("Subscribed", () =>
          Predicate.isTagged(state, "Subscribing")
            ? moveTo(new Recovering({ attempt: state.attempt, controllerName: state.controllerName }))
            : invalid(state, event)
        ),
        Match.tag("Recovered", () =>
          Predicate.isTagged(state, "Recovering")
            ? moveTo(new Ready({ controllerName: state.controllerName }))
            : invalid(state, event)
        ),
        Match.tag("Failed", (failed) =>
          Match.value(state).pipe(
            Match.tag("Connecting", "Handshaking", "Subscribing", "Recovering", (open) =>
              moveTo(new WaitingToReconnect({ attempt: open.attempt, reason: failed.reason }))
            ),
            Match.tag("Ready", () => moveTo(new WaitingToReconnect({ attempt: 1, reason: failed.reason }))),
            Match.orElse(() => invalid(state, event))
          )
        ),
        Match.exhaustive
      )
