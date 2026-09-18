/**
 * What a simulated controller remembers across one client session.
 *
 * The state is the only thing the session loop, the fault-injecting writer and
 * the result pusher share, so it lives apart from all three.
 *
 * @since 0.0.0
 */
import * as O from "effect/Option"
import type { Deferred } from "effect"
import type { TighteningId } from "../src/protocol/TighteningResult.ts"
import type { ServerSide } from "../src/transport/InMemoryTransport.ts"

/**
 * One simulated controller's view of its client.
 *
 * @category models
 * @since 0.0.0
 */
export interface SessionState {
  readonly subscribed: boolean
  readonly keepAlives: number
  readonly stops: number
  readonly nextId: number
  readonly generated: number
  readonly abandoned: ReadonlyArray<TighteningId>
  readonly connection: O.Option<ServerSide>
  readonly pendingAck: O.Option<Deferred.Deferred<void>>
  readonly quiet: boolean
  /** Whether a client has subscribed at least once: nothing is produced before that. */
  readonly everSubscribed: boolean
  /** Frames held back by a `CoalesceFrames` fault, flushed with the next write. */
  readonly pending: ReadonlyArray<Uint8Array>
}

/**
 * A controller that has not been talked to yet.
 *
 * @category constructors
 * @since 0.0.0
 */
export const initialSessionState: SessionState = {
  subscribed: false,
  keepAlives: 0,
  stops: 0,
  nextId: 1,
  generated: 0,
  abandoned: [],
  connection: O.none(),
  pendingAck: O.none(),
  quiet: false,
  everSubscribed: false,
  pending: []
}

/**
 * Forgets a connection only when it is still the current one: an old session
 * cleaning up must never unhook the session that replaced it.
 *
 * @category transitions
 * @since 0.0.0
 */
export const forget = (current: SessionState, connection: ServerSide): SessionState =>
  O.match(current.connection, {
    onNone: () => current,
    onSome: (open) => open === connection ? { ...current, subscribed: false, connection: O.none() } : current
  })

/**
 * The newest identifier the controller has produced, if it has produced any.
 *
 * @category accessors
 * @since 0.0.0
 */
export const latestOf = (current: SessionState): O.Option<number> =>
  current.nextId <= 1 ? O.none() : O.some(current.nextId - 1)
