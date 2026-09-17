/**
 * The connection state machine, as data.
 *
 * Keeping transitions in a pure function means the interesting part of a
 * resilient connection — which failures lead where, and what is impossible —
 * is tested without sockets, timers or fibers.
 *
 * ```text
 * Disconnected ──Connect──► Connecting
 * Connecting ──Opened──► Handshaking       ──Failed──► WaitingToReconnect
 * Handshaking ──Accepted──► Subscribing    ──Failed──► WaitingToReconnect
 * Subscribing ──Subscribed──► Recovering   ──Failed──► WaitingToReconnect
 * Recovering ──Recovered──► Ready          ──Failed──► WaitingToReconnect
 * Ready ──Lost──► WaitingToReconnect
 * WaitingToReconnect ──RetryDue──► Connecting
 * any non-final ──CloseRequested──► Closing ──Released──► Closed
 * ```
 *
 * @since 0.0.0
 */
import { Match, Result } from "effect"
import * as O from "effect/Option"
import * as S from "effect/Schema"

/**
 * Nothing is open yet and no attempt is running.
 *
 * @category models
 * @since 0.0.0
 */
export class Disconnected extends S.TaggedClass<Disconnected>()("Disconnected", {}, {
  description: "Idle, before the first connection attempt"
}) {}

/**
 * A transport connection is being opened.
 *
 * @category models
 * @since 0.0.0
 */
export class Connecting extends S.TaggedClass<Connecting>()("Connecting", {
  attempt: S.Number.check(S.isInt(), S.isGreaterThanOrEqualTo(1))
}, { description: "Opening the transport connection" }) {}

/**
 * The socket is open and the communication start exchange is in flight.
 *
 * @category models
 * @since 0.0.0
 */
export class Handshaking extends S.TaggedClass<Handshaking>()("Handshaking", {
  attempt: S.Number.check(S.isInt(), S.isGreaterThanOrEqualTo(1))
}, { description: "Waiting for the controller to accept the session" }) {}

/**
 * The session is open and subscriptions are being restored.
 *
 * @category models
 * @since 0.0.0
 */
export class Subscribing extends S.TaggedClass<Subscribing>()("Subscribing", {
  attempt: S.Number.check(S.isInt(), S.isGreaterThanOrEqualTo(1)),
  controllerName: S.String
}, { description: "Restoring the tightening result subscription" }) {}

/**
 * Results missed while the connection was down are being fetched.
 *
 * @category models
 * @since 0.0.0
 */
export class Recovering extends S.TaggedClass<Recovering>()("Recovering", {
  attempt: S.Number.check(S.isInt(), S.isGreaterThanOrEqualTo(1)),
  controllerName: S.String
}, { description: "Fetching results missed during the outage" }) {}

/**
 * The connection is live and carrying traffic.
 *
 * @category models
 * @since 0.0.0
 */
export class Ready extends S.TaggedClass<Ready>()("Ready", {
  controllerName: S.String
}, { description: "Connected, subscribed and up to date" }) {}

/**
 * The connection failed and the next attempt is scheduled.
 *
 * @category models
 * @since 0.0.0
 */
export class WaitingToReconnect extends S.TaggedClass<WaitingToReconnect>()("WaitingToReconnect", {
  attempt: S.Number.check(S.isInt(), S.isGreaterThanOrEqualTo(1)),
  reason: S.String
}, { description: "Backing off before the next attempt" }) {}

/**
 * The application asked to close; resources are being released.
 *
 * @category models
 * @since 0.0.0
 */
export class Closing extends S.TaggedClass<Closing>()("Closing", {}, {
  description: "Releasing the session, best effort communication stop"
}) {}

/**
 * Terminal state: the connection will never carry traffic again.
 *
 * @category models
 * @since 0.0.0
 */
export class Closed extends S.TaggedClass<Closed>()("Closed", {
  lastError: S.OptionFromNullishOr(S.String)
}, { description: "Terminal state" }) {}

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
  | Connect
  | Opened
  | Accepted
  | Subscribed
  | Recovered
  | Failed
  | RetryDue
  | CloseRequested
  | Released

/**
 * The application (or the supervisor) asked for a connection.
 *
 * @category models
 * @since 0.0.0
 */
export class Connect extends S.TaggedClass<Connect>()("Connect", {}, {
  description: "Start a connection attempt"
}) {}

/**
 * The transport connection is open.
 *
 * @category models
 * @since 0.0.0
 */
export class Opened extends S.TaggedClass<Opened>()("Opened", {}, {
  description: "The transport connection is open"
}) {}

/**
 * The controller accepted the session.
 *
 * @category models
 * @since 0.0.0
 */
export class Accepted extends S.TaggedClass<Accepted>()("Accepted", {
  controllerName: S.String
}, { description: "The controller accepted the communication start" }) {}

/**
 * Subscriptions were restored.
 *
 * @category models
 * @since 0.0.0
 */
export class Subscribed extends S.TaggedClass<Subscribed>()("Subscribed", {}, {
  description: "The tightening result subscription is active"
}) {}

/**
 * Gap recovery finished.
 *
 * @category models
 * @since 0.0.0
 */
export class Recovered extends S.TaggedClass<Recovered>()("Recovered", {}, {
  description: "Missed results were fetched"
}) {}

/**
 * The attempt or the live session failed.
 *
 * @category models
 * @since 0.0.0
 */
export class Failed extends S.TaggedClass<Failed>()("Failed", {
  reason: S.String
}, { description: "The attempt or session failed" }) {}

/**
 * The backoff delay elapsed.
 *
 * @category models
 * @since 0.0.0
 */
export class RetryDue extends S.TaggedClass<RetryDue>()("RetryDue", {}, {
  description: "The backoff delay elapsed"
}) {}

/**
 * The application asked to close the connection.
 *
 * @category models
 * @since 0.0.0
 */
export class CloseRequested extends S.TaggedClass<CloseRequested>()("CloseRequested", {}, {
  description: "close() was called"
}) {}

/**
 * Every resource of the connection was released.
 *
 * @category models
 * @since 0.0.0
 */
export class Released extends S.TaggedClass<Released>()("Released", {}, {
  description: "Resources were released"
}) {}

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
export const isFinal = (state: ConnectionState): boolean => state._tag === "Closed"

/**
 * Whether the connection can carry application traffic.
 *
 * @category predicates
 * @since 0.0.0
 */
export const isReady = (state: ConnectionState): boolean => state._tag === "Ready"

const attemptOf = (state: ConnectionState): number =>
  Match.value(state).pipe(
    Match.tag("Connecting", "Handshaking", "Subscribing", "Recovering", "WaitingToReconnect", (open) => open.attempt),
    Match.orElse(() => 0)
  )

const succeedState = (state: ConnectionState): Result.Result<ConnectionState, InvalidTransition> =>
  Result.succeed(state)

const invalid = (
  state: ConnectionState,
  event: ConnectionEvent
): Result.Result<ConnectionState, InvalidTransition> =>
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
 * import { Connect, initial, transition } from "effect-open-protocol"
 *
 * const next = transition(initial, new Connect())
 * ```
 *
 * @category transitions
 * @since 0.0.0
 */
export const transition = (
  state: ConnectionState,
  event: ConnectionEvent
): Result.Result<ConnectionState, InvalidTransition> =>
  isFinal(state)
    ? invalid(state, event)
    : Match.value(event).pipe(
      Match.tag("CloseRequested", () => succeedState(new Closing())),
      Match.tag("Released", () =>
        state._tag === "Closing"
          ? succeedState(new Closed({ lastError: O.none() }))
          : invalid(state, event)),
      Match.tag("Connect", () =>
        state._tag === "Disconnected"
          ? succeedState(new Connecting({ attempt: 1 }))
          : invalid(state, event)),
      Match.tag("RetryDue", () =>
        state._tag === "WaitingToReconnect"
          ? succeedState(
            new Connecting({ attempt: attemptOf(state) + 1 })
          )
          : invalid(state, event)),
      Match.tag("Opened", () =>
        state._tag === "Connecting"
          ? succeedState(new Handshaking({ attempt: state.attempt }))
          : invalid(state, event)),
      Match.tag("Accepted", (accepted) =>
        state._tag === "Handshaking"
          ? succeedState(
            new Subscribing({ attempt: state.attempt, controllerName: accepted.controllerName })
          )
          : invalid(state, event)),
      Match.tag("Subscribed", () =>
        state._tag === "Subscribing"
          ? succeedState(new Recovering({ attempt: state.attempt, controllerName: state.controllerName }))
          : invalid(state, event)),
      Match.tag("Recovered", () =>
        state._tag === "Recovering"
          ? succeedState(new Ready({ controllerName: state.controllerName }))
          : invalid(state, event)),
      Match.tag("Failed", (failed) =>
        Match.value(state).pipe(
          Match.tag(
            "Connecting",
            "Handshaking",
            "Subscribing",
            "Recovering",
            (open): Result.Result<ConnectionState, InvalidTransition> =>
              Result.succeed(new WaitingToReconnect({ attempt: open.attempt, reason: failed.reason }))
          ),
          Match.tag(
            "Ready",
            (): Result.Result<ConnectionState, InvalidTransition> =>
              Result.succeed(new WaitingToReconnect({ attempt: 1, reason: failed.reason }))
          ),
          Match.orElse((): Result.Result<ConnectionState, InvalidTransition> => invalid(state, event))
        )),
      Match.exhaustive
    )

/**
 * Marks a closed connection with the error that ended it.
 *
 * @category transitions
 * @since 0.0.0
 */
export const closedWith = (reason: string): ConnectionState => new Closed({ lastError: O.some(reason) })
