/**
 * Keeping one device's result stream contiguous.
 *
 * A recovery pass is the policy that turns "the controller holds results we
 * never received" into "the application has them": it runs at session start,
 * whenever a pushed identifier reveals a gap, and on a timer while the session
 * is up. Only one pass runs at a time per device, so a quiet line and a busy
 * one cost the controller the same single MID 0064.
 *
 * @since 0.0.0
 */
import { Effect, Ref } from "effect"
import * as A from "effect/Array"
import * as O from "effect/Option"
import { resultOf, type TighteningResult } from "../protocol/TighteningResult.ts"
import type { Dedup } from "../results/Dedup.ts"
import type { ResultDelivery } from "../results/ResultDelivery.ts"
import { type Recovery, runRecovery } from "../results/ResultRecovery.ts"
import { RequestOldResultMid } from "../protocol/Messages.ts"
import type { Session } from "./Session.ts"
import type { Pushed } from "./Subscriptions.ts"
import type { DeviceSettings } from "./DeviceSettings.ts"

/**
 * The recovery policy of one device.
 *
 * @category models
 * @since 0.0.0
 */
export interface GapRecovery {
  /** Fetches everything between the last contiguously delivered result and the newest one. */
  readonly recoverGap: (session: Session) => Effect.Effect<void>
  /** Retries, for as long as the session lives, whatever a pass had to leave for later. */
  readonly keepUp: (session: Session) => Effect.Effect<never>
  /** Submits a pushed result, starting a recovery pass first when it reveals a gap or no baseline exists yet. */
  readonly submitPushed: (session: Session, pushed: Pushed<TighteningResult>) => Effect.Effect<void>
}

/**
 * Builds the recovery policy for one device, over the window and the queue it
 * shares with the connection's read loop.
 *
 * A pass started by the timer and one started by a pushed result go through
 * the same policy, so they share its "only one pass at a time" state.
 *
 * **Example** (Recovering what an outage lost)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { GapRecovery } from "effect-open-protocol"
 * import type { Dedup, ResultDelivery, Session, DeviceSettings } from "effect-open-protocol"
 *
 * const recover = (options: {
 *   readonly settings: DeviceSettings
 *   readonly dedup: Dedup.Dedup
 *   readonly pipeline: ResultDelivery.ResultDelivery
 *   readonly session: Session
 * }) => Effect.flatMap(GapRecovery.make(options), (recovery) => recovery.recoverGap(options.session))
 * ```
 *
 * @category constructors
 * @since 0.0.0
 */
export const make = Effect.fnUntraced(function* (options: {
  readonly settings: DeviceSettings
  readonly dedup: Dedup
  readonly pipeline: ResultDelivery
}) {
  const { dedup, pipeline, settings } = options
  const recovering = yield* Ref.make(false)
  // Set when the last pass gave up with identifiers still pending or left
  // beyond the limit; nothing else would ask for them on a quiet line.
  const owed = yield* Ref.make(false)

  const recoverGap = (session: Session): Effect.Effect<void> => {
    const pass = (attempts: number): Effect.Effect<Recovery> =>
      Effect.gen(function* () {
        const recovery = yield* runRecovery({
          dedup,
          request: (tighteningId) =>
            // Recovery is bulk work that retries, so it waits far less than a
            // command does: a slow reply here costs a whole pass.
            Effect.map(
              session.replies.request(RequestOldResultMid.rev(1), { tighteningId }, settings.recoveryTimeout),
              (stored) => resultOf(settings.id, stored)
            ),
          submit: pipeline.submitRecovered,
          limit: settings.recoveryLimit
        })

        if (A.length(recovery.recovered) > 0 || A.length(recovery.missing) > 0 || A.length(recovery.pending) > 0) {
          yield* Effect.logInfo("recovered results missed during the outage").pipe(
            Effect.annotateLogs({
              deviceId: settings.id,
              recovered: A.length(recovery.recovered),
              missing: A.length(recovery.missing),
              pending: A.length(recovery.pending),
              skipped: recovery.skipped
            })
          )
        }

        // A pass fetches at most `recoveryLimit` results. While it stopped at
        // that limit and got somewhere, the rest follows at once: nothing else
        // would ask for it once the line goes quiet.
        if (recovery.skipped > 0 && A.length(recovery.recovered) + A.length(recovery.missing) > 0) {
          return yield* pass(attempts)
        }

        // A pending identifier is one the controller may still have: the request
        // timed out or the link wobbled. Giving up on it here is how a result
        // gets lost, so the pass repeats, and `keepUp` takes over after that.
        if (A.length(recovery.pending) > 0 && attempts > 1) {
          yield* Effect.sleep(settings.recoveryRetryDelay)

          return yield* pass(attempts - 1)
        }

        return recovery
      })

    return Effect.gen(function* () {
      const busy = yield* Ref.getAndSet(recovering, true)

      if (busy) {
        return
      }

      const left = yield* pass(settings.recoveryAttempts).pipe(
        Effect.map((recovery) => A.length(recovery.pending) > 0 || recovery.skipped > 0),
        Effect.catchCause((cause) => Effect.as(Effect.logWarning("gap recovery failed, continuing", cause), true)),
        Effect.ensuring(Ref.set(recovering, false))
      )

      yield* Ref.set(owed, left)
    })
  }

  const submitPushed = Effect.fnUntraced(function* (session: Session, pushed: Pushed<TighteningResult>) {
    const watermark = yield* dedup.lastDelivered

    // Without a baseline nothing can reveal a gap, so the result asks for one.
    if (O.isNone(watermark) || pushed.value.tighteningId > watermark.value + 1) {
      yield* Effect.forkChild(recoverGap(session))
    }

    yield* pipeline.submitPushed(pushed)
  })

  const keepUp = (session: Session): Effect.Effect<never> =>
    Effect.forever(
      Effect.andThen(
        Effect.sleep(settings.recoveryRetryDelay),
        Effect.flatMap(Ref.get(owed), (left) => (left ? recoverGap(session) : Effect.void))
      )
    )

  return { recoverGap, keepUp, submitPushed } satisfies GapRecovery
})
