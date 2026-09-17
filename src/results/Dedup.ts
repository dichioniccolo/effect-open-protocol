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
  const state = yield* Ref.make<State>({ ids: [], watermark: O.none(), ahead: [] })

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
        // Controllers do not start counting at one. The first result we
        // deliver is the baseline, whatever number it carries.
        onNone: () => ({ ids, ...advance(id, A.filter(ahead, (value) => value !== id)) }),
        onSome: (mark) =>
          id === mark + 1
            ? { ids, ...advance(id, A.filter(ahead, (value) => value !== id)) }
            : { ids, watermark: current.watermark, ahead }
      })
    })

  const markBaseline = (id: TighteningId): Effect.Effect<void> =>
    Ref.update(state, (current) =>
      O.isSome(current.watermark) ? current : { ...current, ...advance(id, current.ahead) })

  return {
    seen,
    remember,
    markBaseline,
    lastDelivered: Effect.map(Ref.get(state), (current) => current.watermark)
  } satisfies Dedup
})
