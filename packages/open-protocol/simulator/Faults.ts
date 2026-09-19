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
import { Data, Duration, Effect, Match, Random } from "effect"
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
 * Probability in `[0, 1]` that a given opportunity produces a fault.
 *
 * @category models
 * @since 0.0.0
 */
export const FaultRate = S.Number.check(S.isBetween({ minimum: 0, maximum: 1 })).annotate({
  identifier: "FaultRate",
  description: "Probability in [0, 1] that an opportunity produces a fault"
})

/**
 * @category models
 * @since 0.0.0
 */
export type FaultRate = typeof FaultRate.Type

/**
 * How aggressively faults are injected.
 *
 * @category models
 * @since 0.0.0
 */
export class FaultConfig extends S.Class<FaultConfig>("FaultConfig")(
  {
    rate: FaultRate,
    /** Kinds allowed in this run; a run with none to allow has no `FaultConfig` at all. */
    kinds: S.NonEmptyArray(FaultKind).pipe(S.withConstructorDefault(Effect.succeed(FaultKind.literals))),
    /** Upper bound for injected reply delays. */
    maxDelay: S.Duration.pipe(S.withConstructorDefault(Effect.succeed(Duration.seconds(8)))),
    /** Upper bound for how long a link stays silent or refuses connections. */
    maxOutage: S.Duration.pipe(S.withConstructorDefault(Effect.succeed(Duration.seconds(5))))
  },
  { description: "How aggressively faults are injected during a chaos run" }
) {}

/**
 * The fault decided for one opportunity.
 *
 * @category models
 * @since 0.0.0
 */
export type Fault = Data.TaggedEnum<{
  None: {}
  DropConnection: {}
  GoSilent: { readonly duration: Duration.Duration }
  DelayReply: { readonly duration: Duration.Duration }
  SplitFrame: { readonly pieces: number }
  CoalesceFrames: {}
  RejectCommand: { readonly code: number }
  RefuseConnections: { readonly duration: Duration.Duration }
}>

/**
 * Constructors for each `Fault` variant.
 *
 * @category constructors
 * @since 0.0.0
 */
export const Fault = Data.taggedEnum<Fault>()

const none = Fault.None()

const pickDuration = (max: Duration.Duration): Effect.Effect<Duration.Duration> =>
  Effect.map(Random.nextIntBetween(1, Math.max(2, Duration.toMillis(max))), (millis) => Duration.millis(millis))

const faultOf = (kind: FaultKind, config: FaultConfig): Effect.Effect<Fault> =>
  Match.value(kind).pipe(
    Match.when("dropConnection", (): Effect.Effect<Fault> => Effect.succeed(Fault.DropConnection())),
    Match.when("goSilent", (): Effect.Effect<Fault> =>
      Effect.map(pickDuration(config.maxOutage), (duration) => Fault.GoSilent({ duration }))
    ),
    Match.when("delayReply", (): Effect.Effect<Fault> =>
      Effect.map(pickDuration(config.maxDelay), (duration) => Fault.DelayReply({ duration }))
    ),
    Match.when("splitFrame", (): Effect.Effect<Fault> =>
      Effect.map(Random.nextIntBetween(2, 5), (pieces) => Fault.SplitFrame({ pieces }))
    ),
    Match.when("coalesceFrames", (): Effect.Effect<Fault> => Effect.succeed(Fault.CoalesceFrames())),
    Match.when("rejectCommand", (): Effect.Effect<Fault> => Effect.succeed(Fault.RejectCommand({ code: 79 }))),
    Match.when("refuseConnections", (): Effect.Effect<Fault> =>
      Effect.map(pickDuration(config.maxOutage), (duration) => Fault.RefuseConnections({ duration }))
    ),
    Match.exhaustive
  )

/**
 * Decides whether this opportunity produces a fault, and which one.
 *
 * **Example** (Deciding a fault under a fixed seed)
 *
 * ```ts
 * import { Effect, Random } from "effect"
 * import { FaultConfig, next } from "effect-open-protocol/simulator/Faults.ts"
 *
 * const decision = Random.withSeed(42)(next(FaultConfig.makeUnsafe({ rate: 0.5 })))
 * ```
 *
 * @category constructors
 * @since 0.0.0
 */
export const next = (config: FaultConfig): Effect.Effect<Fault> =>
  Effect.gen(function* () {
    const roll = yield* Random.next

    if (roll >= config.rate) {
      return none
    }

    return yield* faultOf(yield* Random.choice(config.kinds), config)
  })

/**
 * Splits a frame into `pieces` chunks so the framer sees arbitrary boundaries.
 *
 * @category transformations
 * @since 0.0.0
 */
export const split = (bytes: Uint8Array, pieces: number): ReadonlyArray<Uint8Array> => {
  const size = Math.max(1, Math.ceil(bytes.length / pieces))

  return A.map(A.range(0, Math.max(0, Math.ceil(bytes.length / size) - 1)), (index) =>
    bytes.slice(index * size, Math.min(bytes.length, (index + 1) * size))
  )
}
