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
import { Effect, Layer, Ref } from "effect"
import * as Context from "effect/Context"
import * as A from "effect/Array"
import * as O from "effect/Option"
import type { TighteningResult } from "../protocol/TighteningResult.ts"
import { Dedup } from "../results/Dedup.ts"
import { ResultDelivery } from "../results/ResultDelivery.ts"
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
export interface GapRecoveryService {
  /** Fetches everything between the last contiguously delivered result and the newest one. */
  readonly recoverGap: (session: Session) => Effect.Effect<void>
  /** Submits a pushed result, starting a recovery pass first when it reveals a gap. */
  readonly submitResult: (session: Session, result: TighteningResult) => Effect.Effect<void>
}

/** Builds the recovery policy for one device. */
export const make = Effect.fnUntraced(function* (options: { readonly settings: DeviceSettings }) {
  const settings = options.settings
  const dedup = yield* Dedup
  const pipeline = yield* ResultDelivery
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

    const attempt = (attempts: number): Effect.Effect<void> =>
      pass(attempts).pipe(
        Effect.catchCause((cause) => Effect.logWarning("gap recovery failed, continuing", cause)),
        Effect.asVoid
      )

    return Effect.gen(function* () {
      const busy = yield* Ref.getAndSet(recovering, true)

      if (busy) {
        return
      }

      yield* Effect.ensuring(attempt(settings.recoveryAttempts), Ref.set(recovering, false))
    })
  }

  const submitResult = Effect.fnUntraced(function* (session: Session, result: TighteningResult) {
    const watermark = yield* dedup.lastDelivered

    if (O.isSome(watermark) && result.tighteningId > watermark.value + 1) {
      yield* Effect.forkChild(recoverGap(session))
    }

    yield* pipeline.submit(result)
  })

  return { recoverGap, submitResult } satisfies GapRecoveryService
})

/**
 * The gap policy of one device.
 *
 * A connection provides `GapRecovery.layer` for itself over its `Dedup` and
 * `ResultDelivery`, so a pass started by the timer and one started by a pushed
 * result share the same "only one pass at a time" state.
 *
 * **Example** (Recovering what an outage lost)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { GapRecovery } from "effect-open-protocol"
 * import type { Session } from "effect-open-protocol"
 *
 * const recover = (session: Session) =>
 *   Effect.flatMap(GapRecovery, (recovery) => recovery.recoverGap(session))
 * ```
 *
 * @category services
 * @since 0.0.0
 */
export class GapRecovery extends Context.Service<GapRecovery, GapRecoveryService>()(
  "effect-open-protocol/GapRecovery"
) {}

/**
 * Provides the recovery policy for `settings` for the lifetime of the layer.
 *
 * @category layers
 * @since 0.0.0
 */
export const layer = (options: {
  readonly settings: DeviceSettings
}): Layer.Layer<GapRecovery, never, Dedup | ResultDelivery> => Layer.effect(GapRecovery)(make(options))
