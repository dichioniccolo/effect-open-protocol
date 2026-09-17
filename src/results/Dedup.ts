/**
 * Duplicate detection for delivered tightening results.
 *
 * A result is acknowledged only after the application handler succeeded, so a
 * connection lost between those two steps makes the controller resend a result
 * we already delivered. The dedup store remembers the last `capacity`
 * identifiers per device, which is enough to recognise those resends without
 * growing without bound.
 *
 * It lives in memory: a process restart forgets everything, so the handler
 * must be idempotent on `(deviceId, tighteningId)`. That is an integration
 * requirement, not a detail — the README states it.
 *
 * @since 0.0.0
 */
import { Effect, Ref } from "effect"
import * as A from "effect/Array"
import * as O from "effect/Option"
import { TighteningId } from "../protocol/TighteningResult.ts"

/**
 * Remembers which results were already handed to the application.
 *
 * @category models
 * @since 0.0.0
 */
export interface Dedup {
  /** Whether this identifier was already delivered. */
  readonly seen: (id: TighteningId) => Effect.Effect<boolean>
  /** Records an identifier as delivered, evicting the oldest when full. */
  readonly remember: (id: TighteningId) => Effect.Effect<void>
  /** Highest identifier delivered so far, used to detect gaps after an outage. */
  readonly lastDelivered: Effect.Effect<O.Option<TighteningId>>
  /**
   * Records where recovery should start without claiming the identifier was
   * delivered. Used once, on the first connection: results produced before the
   * application was listening are history, not data it lost.
   */
  readonly markBaseline: (id: TighteningId) => Effect.Effect<void>
  /**
   * Records that the controller holds no results at all, so the next one it
   * produces is the first we could ever have seen and becomes the baseline.
   */
  readonly markNoHistory: Effect.Effect<void>
  /** Whether the controller has told us, at some point, that it held nothing. */
  readonly sawEmptyHistory: Effect.Effect<boolean>
}

interface State {
  readonly ids: ReadonlyArray<TighteningId>
  /**
   * Highest identifier below which nothing is missing. It advances only
   * contiguously: delivering 30 while 25 is still missing must not convince
   * recovery that 25 was handled.
   */
  readonly watermark: O.Option<TighteningId>
  /** Delivered identifiers sitting above the watermark, waiting for the gap to close. */
  readonly ahead: ReadonlyArray<TighteningId>
  /** Set when the controller told us it has nothing stored. */
  readonly emptyHistory: boolean
}

/**
 * Default number of identifiers kept per device.
 *
 * @category constants
 * @since 0.0.0
 */
export const defaultCapacity = 1000

/**
 * Builds a bounded dedup store.
 *
 * **Example** (Recognising a resend)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { Dedup, TighteningId } from "effect-open-protocol"
 *
 * const program = Effect.gen(function* () {
 *   const dedup = yield* Dedup.make(16)
 *   const id = TighteningId.make(7)
 *   yield* dedup.remember(id)
 *   return yield* dedup.seen(id)
 * })
 * ```
 *
 * @category constructors
 * @since 0.0.0
 */
export const make = Effect.fnUntraced(function* (capacity: number = defaultCapacity) {
  const state = yield* Ref.make<State>({ ids: [], watermark: O.none(), ahead: [], emptyHistory: false })

  /** Advances the watermark across every identifier already delivered. */
  const advance = (from: TighteningId, ahead: ReadonlyArray<TighteningId>): {
    readonly watermark: O.Option<TighteningId>
    readonly ahead: ReadonlyArray<TighteningId>
  } => {
    const next = TighteningId.make(from + 1)
    return A.contains(ahead, next)
      ? advance(next, A.filter(ahead, (id) => id !== next))
      : { watermark: O.some(from), ahead }
  }

  const seen = (id: TighteningId): Effect.Effect<boolean> =>
    Effect.map(Ref.get(state), (current) => A.contains(current.ids, id))

  const remember = (id: TighteningId): Effect.Effect<void> =>
    Ref.update(state, (current) => {
      const kept = A.contains(current.ids, id) ? current.ids : A.append(current.ids, id)
      const ids = A.length(kept) > capacity ? A.drop(kept, A.length(kept) - capacity) : kept
      const ahead = A.contains(current.ahead, id) ? current.ahead : A.append(current.ahead, id)
      return O.match(current.watermark, {
        // Without a baseline the identifier is held aside: treating whatever
        // arrives first as the baseline would write off everything older that
        // we never received. The exception is a controller that told us it has
        // nothing stored, where the first result really is the first there is.
        onNone: () =>
          current.emptyHistory
            ? { ...current, ids, ...advance(id, A.filter(ahead, (value) => value !== id)) }
            : { ...current, ids, ahead },
        onSome: (mark) =>
          id === mark + 1
            ? { ...current, ids, ...advance(id, A.filter(ahead, (value) => value !== id)) }
            : { ...current, ids, ahead }
      })
    })

  const markBaseline = (id: TighteningId): Effect.Effect<void> =>
    Ref.update(state, (current) =>
      O.isSome(current.watermark) ? current : { ...current, ...advance(id, current.ahead) })

  const markNoHistory: Effect.Effect<void> = Ref.update(state, (current) =>
    O.isSome(current.watermark) || A.length(current.ahead) === 0
      ? { ...current, emptyHistory: true }
      // A result already arrived while we were asking: it is the baseline.
      : { ...current, emptyHistory: true, ...advance(A.headNonEmpty(current.ahead as A.NonEmptyArray<TighteningId>), current.ahead) })

  return {
    seen,
    remember,
    markBaseline,
    markNoHistory,
    sawEmptyHistory: Effect.map(Ref.get(state), (current) => current.emptyHistory),
    lastDelivered: Effect.map(Ref.get(state), (current) => current.watermark)
  } satisfies Dedup
})
