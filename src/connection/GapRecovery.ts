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
import type { TighteningResult } from "../protocol/TighteningResult.ts"
import type { Dedup } from "../results/Dedup.ts"
import type { ResultDelivery } from "../results/ResultDelivery.ts"
import { runRecovery } from "../results/ResultRecovery.ts"
import { expectReply } from "./RequestReply.ts"
import type { Session } from "./Session.ts"
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
  /** Submits a pushed result, starting a recovery pass first when it reveals a gap. */
  readonly submitResult: (session: Session, result: TighteningResult) => Effect.Effect<void>
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

  const recoverGap = (session: Session): Effect.Effect<void> => {
    const pass = (attempts: number): Effect.Effect<void> =>
      Effect.gen(function* () {
        const recovery = yield* runRecovery({
          dedup,
          request: (message, mid) =>
            // Recovery is bulk work that retries, so it waits far less than a
            // command does: a slow reply here costs a whole pass.
            session.replies.request(message, mid, expectReply(mid, "OldResult"), settings.recoveryTimeout),
          submit: pipeline.submit,
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

        // A pending identifier is one the controller may still have: the request
        // timed out or the link wobbled. Giving up on it here is how a result
        // gets lost, so the pass repeats while the session lives.
        if (A.length(recovery.pending) > 0 && attempts > 1) {
          yield* Effect.sleep(settings.recoveryRetryDelay)
          yield* pass(attempts - 1)
        }
      })

    return Effect.gen(function* () {
      const busy = yield* Ref.getAndSet(recovering, true)

      if (busy) {
        return
      }

      yield* pass(settings.recoveryAttempts).pipe(
        Effect.catchCause((cause) => Effect.logWarning("gap recovery failed, continuing", cause)),
        Effect.ensuring(Ref.set(recovering, false))
      )
    })
  }

  const submitResult = Effect.fnUntraced(function* (session: Session, result: TighteningResult) {
    const watermark = yield* dedup.lastDelivered

    if (O.isSome(watermark) && result.tighteningId > watermark.value + 1) {
      yield* Effect.forkChild(recoverGap(session))
    }

    yield* pipeline.submit(result)
  })

  return { recoverGap, submitResult } satisfies GapRecovery
})
