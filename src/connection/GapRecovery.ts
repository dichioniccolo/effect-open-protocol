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
import { Effect, pipe, Ref } from "effect"
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
  readonly recoverGap: (session: Session, pipeline: ResultDelivery) => Effect.Effect<void>
  /** Submits a pushed result, starting a recovery pass first when it reveals a gap. */
  readonly submitResult: (session: Session, pipeline: ResultDelivery, result: TighteningResult) => Effect.Effect<void>
}

/**
 * Builds the recovery policy for one device.
 *
 * @category constructors
 * @since 0.0.0
 */
export const makeGapRecovery = Effect.fnUntraced(function* (options: {
  readonly settings: DeviceSettings
  readonly dedup: Dedup
}) {
  const { dedup, settings } = options
  const recovering = yield* Ref.make(false)

  const recoverGap = (session: Session, pipeline: ResultDelivery): Effect.Effect<void> => {
    const pass = (attempts: number): Effect.Effect<void> =>
      pipe(
        runRecovery({
          dedup,
          request: (message, mid) =>
            // Recovery is bulk work that retries, so it waits far less than a
            // command does: a slow reply here costs a whole pass.
            session.replies.request(message, mid, expectReply(mid, "OldResult"), settings.recoveryTimeout),
          submit: pipeline.submit,
          limit: settings.recoveryLimit
        }),
        Effect.tap((recovery) =>
          A.length(recovery.recovered) === 0 && A.length(recovery.missing) === 0 && A.length(recovery.pending) === 0
            ? Effect.void
            : Effect.logInfo("recovered results missed during the outage").pipe(
                Effect.annotateLogs({
                  deviceId: settings.id,
                  recovered: A.length(recovery.recovered),
                  missing: A.length(recovery.missing),
                  pending: A.length(recovery.pending),
                  skipped: recovery.skipped
                })
              )
        ),
        Effect.flatMap((recovery) =>
          // A pending identifier is one the controller may still have: the
          // request timed out or the link wobbled. Giving up on it here is how
          // a result gets lost, so the pass repeats while the session lives.
          A.length(recovery.pending) === 0 || attempts <= 1
            ? Effect.void
            : Effect.andThen(Effect.sleep(settings.recoveryRetryDelay), pass(attempts - 1))
        ),
        Effect.catchCause((cause) => Effect.logWarning("gap recovery failed, continuing", cause)),
        Effect.asVoid
      )

    return Ref.getAndSet(recovering, true).pipe(
      Effect.flatMap((busy) =>
        busy ? Effect.void : Effect.ensuring(pass(settings.recoveryAttempts), Ref.set(recovering, false))
      )
    )
  }

  const submitResult = (session: Session, pipeline: ResultDelivery, result: TighteningResult): Effect.Effect<void> =>
    pipe(
      dedup.lastDelivered,
      Effect.flatMap((watermark) =>
        O.match(watermark, {
          onNone: () => Effect.void,
          onSome: (mark) =>
            result.tighteningId > mark + 1
              ? Effect.asVoid(Effect.forkChild(recoverGap(session, pipeline)))
              : Effect.void
        })
      ),
      Effect.andThen(pipeline.submit(result))
    )

  return { recoverGap, submitResult } satisfies GapRecovery
})
