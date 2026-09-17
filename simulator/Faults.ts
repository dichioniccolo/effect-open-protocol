/**
 * Reproducible fault injection for the simulated controller.
 *
 * Every decision comes from a seeded generator, so a chaos run that finds a
 * bug can be replayed exactly with the same `--seed`. The faults mirror what
 * actually goes wrong on a factory floor: yanked cables, silent links,
 * fragmented or coalesced frames, and controllers that reject commands or
 * refuse connections while they reboot.
 *
 * @since 0.0.0
 */
import { Duration, Effect, Match, Random } from "effect"
import * as A from "effect/Array"
import * as S from "effect/Schema"

/**
 * The kinds of misbehaviour a simulated controller can exhibit.
 *
 * @category models
 * @since 0.0.0
 */
export const FaultKind = S.Literals([
  "dropConnection",
  "goSilent",
  "delayReply",
  "splitFrame",
  "coalesceFrames",
  "rejectCommand",
  "refuseConnections"
]).annotate({
  identifier: "FaultKind",
  description: "A way a controller can misbehave during a chaos run"
})

/**
 * @category models
 * @since 0.0.0
 */
export type FaultKind = typeof FaultKind.Type

/**
 * How aggressively faults are injected.
 *
 * @category models
 * @since 0.0.0
 */
export interface FaultConfig {
  /** Probability in `[0, 1]` that a given opportunity produces a fault. */
  readonly rate: number
  /** Kinds allowed in this run; defaults to all of them. */
  readonly kinds?: ReadonlyArray<FaultKind> | undefined
  /** Upper bound for injected reply delays. */
  readonly maxDelay?: Duration.Duration | undefined
  /** Upper bound for how long a link stays silent or refuses connections. */
  readonly maxOutage?: Duration.Duration | undefined
}

/**
 * The fault decided for one opportunity.
 *
 * @category models
 * @since 0.0.0
 */
export type Fault =
  | { readonly _tag: "None" }
  | { readonly _tag: "DropConnection" }
  | { readonly _tag: "GoSilent"; readonly duration: Duration.Duration }
  | { readonly _tag: "DelayReply"; readonly duration: Duration.Duration }
  | { readonly _tag: "SplitFrame"; readonly pieces: number }
  | { readonly _tag: "CoalesceFrames" }
  | { readonly _tag: "RejectCommand"; readonly code: number }
  | { readonly _tag: "RefuseConnections"; readonly duration: Duration.Duration }

const none: Fault = { _tag: "None" }

const allKinds: ReadonlyArray<FaultKind> = FaultKind.literals

const pickDuration = (max: Duration.Duration): Effect.Effect<Duration.Duration> =>
  Effect.map(
    Random.nextIntBetween(1, Math.max(2, Duration.toMillis(max))),
    (millis) => Duration.millis(millis)
  )

const faultOf = (kind: FaultKind, config: FaultConfig): Effect.Effect<Fault> => {
  const maxDelay = config.maxDelay ?? Duration.seconds(8)
  const maxOutage = config.maxOutage ?? Duration.seconds(5)
  return Match.value(kind).pipe(
    Match.when("dropConnection", (): Effect.Effect<Fault> => Effect.succeed({ _tag: "DropConnection" })),
    Match.when(
      "goSilent",
      (): Effect.Effect<Fault> =>
        Effect.map(pickDuration(maxOutage), (duration) => ({ _tag: "GoSilent", duration }))
    ),
    Match.when(
      "delayReply",
      (): Effect.Effect<Fault> =>
        Effect.map(pickDuration(maxDelay), (duration) => ({ _tag: "DelayReply", duration }))
    ),
    Match.when(
      "splitFrame",
      (): Effect.Effect<Fault> =>
        Effect.map(Random.nextIntBetween(2, 5), (pieces) => ({ _tag: "SplitFrame", pieces }))
    ),
    Match.when("coalesceFrames", (): Effect.Effect<Fault> => Effect.succeed({ _tag: "CoalesceFrames" })),
    Match.when("rejectCommand", (): Effect.Effect<Fault> => Effect.succeed({ _tag: "RejectCommand", code: 79 })),
    Match.when(
      "refuseConnections",
      (): Effect.Effect<Fault> =>
        Effect.map(pickDuration(maxOutage), (duration) => ({ _tag: "RefuseConnections", duration }))
    ),
    Match.exhaustive
  )
}

/**
 * Decides whether this opportunity produces a fault, and which one.
 *
 * **Example** (Deciding a fault under a fixed seed)
 *
 * ```ts
 * import { Effect, Random } from "effect"
 * import { next } from "../simulator/Faults.ts"
 *
 * const decision = Random.withSeed(42)(next({ rate: 0.5 }))
 * ```
 *
 * @category constructors
 * @since 0.0.0
 */
export const next = (config: FaultConfig): Effect.Effect<Fault> =>
  Effect.gen(function* () {
    const kinds = config.kinds ?? allKinds
    const roll = yield* Random.next
    if (roll >= config.rate || A.length(kinds) === 0) {
      return none
    }
    const index = yield* Random.nextIntBetween(0, A.length(kinds))
    const kind = A.get(A.fromIterable(kinds), index)
    return kind._tag === "Some" ? yield* faultOf(kind.value, config) : none
  })

/**
 * Splits a frame into `pieces` chunks so the framer sees arbitrary boundaries.
 *
 * @category transformations
 * @since 0.0.0
 */
export const split = (bytes: Uint8Array, pieces: number): ReadonlyArray<Uint8Array> => {
  const size = Math.max(1, Math.ceil(bytes.length / pieces))
  return A.map(
    A.range(0, Math.max(0, Math.ceil(bytes.length / size) - 1)),
    (index) => bytes.slice(index * size, Math.min(bytes.length, (index + 1) * size))
  )
}
