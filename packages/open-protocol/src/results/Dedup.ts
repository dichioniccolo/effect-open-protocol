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
 * requirement, not a detail — docs/REFERENCE.md states it.
 *
 * @since 0.0.0
 */
import { Effect, Ref } from "effect"
import * as A from "effect/Array"
import * as HashSet from "effect/HashSet"
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
  /** Membership of the last `capacity` identifiers, for constant time lookups. */
  readonly ids: HashSet.HashSet<TighteningId>
  /** The same identifiers in arrival order, which is the order they are evicted in. */
  readonly order: ReadonlyArray<TighteningId>
  /**
   * Highest identifier below which nothing is missing. It advances only
   * contiguously: delivering 30 while 25 is still missing must not convince
   * recovery that 25 was handled.
   */
  readonly watermark: O.Option<TighteningId>
  /** Delivered identifiers sitting above the watermark, waiting for the gap to close. */
  readonly ahead: HashSet.HashSet<TighteningId>
  /** Set when the controller told us it has nothing stored. */
  readonly emptyHistory: boolean
}

/** Advances the watermark across every identifier already delivered. */
const advance = (from: TighteningId, ahead: HashSet.HashSet<TighteningId>): Pick<State, "watermark" | "ahead"> => {
  const next = TighteningId.make(from + 1)

  return HashSet.has(ahead, next) ? advance(next, HashSet.remove(ahead, next)) : { watermark: O.some(from), ahead }
}

/** The oldest identifier held aside, which is where a baseline has to start. */
const lowestAhead = (ahead: HashSet.HashSet<TighteningId>): O.Option<TighteningId> =>
  A.reduce(A.fromIterable(ahead), O.none<TighteningId>(), (lowest, id) =>
    O.match(lowest, { onNone: () => O.some(id), onSome: (value) => O.some(id < value ? id : value) })
  )

/**
 * Builds the duplicate window of one device.
 *
 * A connection builds one for itself and hands it to both its delivery queue
 * and its gap recovery, so they share one window and nothing leaks between
 * devices.
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
export const make = Effect.fnUntraced(function* (capacity: number) {
  const state = yield* Ref.make<State>({
    ids: HashSet.empty<TighteningId>(),
    order: [],
    watermark: O.none(),
    ahead: HashSet.empty<TighteningId>(),
    emptyHistory: false
  })

  /** Records the identifier, evicting the oldest once the window is full. */
  const record = (current: State, id: TighteningId): Pick<State, "ids" | "order"> => {
    if (HashSet.has(current.ids, id)) {
      return { ids: current.ids, order: current.order }
    }

    const order = A.append(current.order, id)

    return A.length(order) <= capacity
      ? { ids: HashSet.add(current.ids, id), order }
      : O.match(A.head(order), {
          onNone: () => ({ ids: HashSet.add(current.ids, id), order }),
          onSome: (oldest) => ({
            ids: HashSet.add(HashSet.remove(current.ids, oldest), id),
            order: A.drop(order, 1)
          })
        })
  }

  const seen = (id: TighteningId): Effect.Effect<boolean> =>
    Effect.map(Ref.get(state), (current) => HashSet.has(current.ids, id))

  const remember = (id: TighteningId): Effect.Effect<void> =>
    Ref.update(state, (current) => {
      const kept = record(current, id)
      const ahead = HashSet.add(current.ahead, id)

      return O.match(current.watermark, {
        // Without a baseline the identifier is held aside: treating whatever
        // arrives first as the baseline would write off everything older that
        // we never received. The exception is a controller that told us it has
        // nothing stored, where the first result really is the first there is.
        onNone: () =>
          current.emptyHistory
            ? { ...current, ...kept, ...advance(id, HashSet.remove(ahead, id)) }
            : { ...current, ...kept, ahead },
        onSome: (mark) =>
          id === mark + 1
            ? { ...current, ...kept, ...advance(id, HashSet.remove(ahead, id)) }
            : { ...current, ...kept, ahead }
      })
    })

  const markBaseline = (id: TighteningId): Effect.Effect<void> =>
    Ref.update(state, (current) =>
      O.isSome(current.watermark) ? current : { ...current, ...advance(id, current.ahead) }
    )

  const markNoHistory: Effect.Effect<void> = Ref.update(state, (current) =>
    O.isSome(current.watermark)
      ? { ...current, emptyHistory: true }
      : // A result already arrived while we were asking: it is the baseline.
        O.match(lowestAhead(current.ahead), {
          onNone: () => ({ ...current, emptyHistory: true }),
          onSome: (lowest) => ({
            ...current,
            emptyHistory: true,
            ...advance(lowest, HashSet.remove(current.ahead, lowest))
          })
        })
  )

  return {
    seen,
    remember,
    markBaseline,
    markNoHistory,
    sawEmptyHistory: Effect.map(Ref.get(state), (current) => current.emptyHistory),
    lastDelivered: Effect.map(Ref.get(state), (current) => current.watermark)
  } satisfies Dedup
})
