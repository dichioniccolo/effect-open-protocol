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
import type { TighteningId } from "../protocol/TighteningResult.ts"

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
}

interface State {
  readonly ids: ReadonlyArray<TighteningId>
  readonly last: O.Option<TighteningId>
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
  const state = yield* Ref.make<State>({ ids: [], last: O.none() })

  const seen = (id: TighteningId): Effect.Effect<boolean> =>
    Effect.map(Ref.get(state), (current) => A.contains(current.ids, id))

  const remember = (id: TighteningId): Effect.Effect<void> =>
    Ref.update(state, (current) => {
      const kept = A.contains(current.ids, id) ? current.ids : A.append(current.ids, id)
      return {
        ids: A.length(kept) > capacity ? A.drop(kept, A.length(kept) - capacity) : kept,
        last: O.match(current.last, {
          onNone: () => O.some(id),
          onSome: (previous) => O.some(previous > id ? previous : id)
        })
      }
    })

  const markBaseline = (id: TighteningId): Effect.Effect<void> =>
    Ref.update(state, (current) => O.isSome(current.last) ? current : { ...current, last: O.some(id) })

  return {
    seen,
    remember,
    markBaseline,
    lastDelivered: Effect.map(Ref.get(state), (current) => current.last)
  } satisfies Dedup
})
