/**
 * Delivering tightening results to the application, exactly once where the
 * protocol allows it and at least once where it does not.
 *
 * The order matters and is the heart of the library:
 *
 * ```text
 * result arrives → already seen? → yes: acknowledge again, do not call the handler
 *                                → no:  call the handler (with retries)
 *                                         success → remember → acknowledge
 *                                         failure → no acknowledge, log
 * ```
 *
 * The acknowledgement is what tells the controller the result is safe, so it
 * is sent only after the application has taken responsibility for it. Only a
 * pushed MID 0061 takes one. A result fetched with MID 0064 has no
 * acknowledgement to send. A MID 0062 names no result, so sending one for it
 * could acknowledge a pushed result the handler has not taken yet.
 *
 * @since 0.0.0
 */
import { Cause, Effect, pipe, Queue, Ref, type Schedule } from "effect"
import type { TighteningResult } from "../protocol/TighteningResult.ts"
import type { Pushed } from "../connection/Subscriptions.ts"
import type { Dedup } from "./Dedup.ts"

/**
 * What the application does with a result. Failing means "I did not take it":
 * the result is not acknowledged.
 *
 * @category models
 * @since 0.0.0
 */
export type ResultHandler = (result: TighteningResult) => Effect.Effect<void, unknown>

/**
 * A running delivery pipeline for one device.
 *
 * @category models
 * @since 0.0.0
 */
export interface ResultDelivery {
  /** Enqueues a pushed result and acknowledges it once handled. Waits when the buffer is full (backpressure). */
  readonly submitPushed: (pushed: Pushed<TighteningResult>) => Effect.Effect<void>
  /** Enqueues a result fetched with MID 0064, which takes no acknowledgement. Waits when the buffer is full. */
  readonly submitRecovered: (result: TighteningResult) => Effect.Effect<void>
  /** Results handed to the handler, duplicates excluded. */
  readonly delivered: Effect.Effect<number>
  /** Results recognised as resends of something already delivered. */
  readonly duplicates: Effect.Effect<number>
}

interface Counters {
  readonly delivered: number
  readonly duplicates: number
}

const drop = (result: TighteningResult): Effect.Effect<void> =>
  Effect.logDebug("dropping a result: no handler is configured").pipe(
    Effect.annotateLogs({ deviceId: result.deviceId, tighteningId: result.tighteningId })
  )

/**
 * The pipeline of a connection nobody is listening to: every result is logged
 * and dropped, and both counters stay at zero.
 *
 * It exists so the connection can say what it does with a result once, instead
 * of asking whether a handler was configured at every use.
 *
 * **Example** (A connection with no result handler)
 *
 * ```ts
 * import { Effect } from "effect"
 * import { ResultDelivery } from "effect-open-protocol"
 *
 * const program = Effect.map(ResultDelivery.dropping.delivered, (count) => count === 0)
 * ```
 *
 * @category constructors
 * @since 0.0.0
 */
export const dropping: ResultDelivery = {
  submitPushed: (pushed) => drop(pushed.value),
  submitRecovered: drop,
  delivered: Effect.succeed(0),
  duplicates: Effect.succeed(0)
}

/** A result waiting for the handler, with what to run once it is handled. */
interface Queued {
  readonly value: TighteningResult
  readonly ack: Effect.Effect<void>
}

/** Sends a pushed result's acknowledgement, logging a failure instead of raising it. */
const acknowledge = Effect.fnUntraced(
  function* (pushed: Pushed<TighteningResult>) {
    yield* pushed.ack
    yield* Effect.logDebug("acknowledged a result")
  },
  Effect.catchCause((cause) => Effect.logWarning("could not acknowledge a result", cause)),
  (effect, pushed) =>
    Effect.annotateLogs(effect, { deviceId: pushed.value.deviceId, tighteningId: pushed.value.tighteningId })
)

/**
 * Starts the delivery loop for a device, for the lifetime of the calling scope.
 *
 * A pushed result's `ack` runs only after the handler succeeded, or
 * immediately for a duplicate whose earlier acknowledgement never reached the
 * controller. A recovered result's `ack` does nothing. `dedup` is the
 * device's window, shared with its gap recovery so both see the same record
 * of what was delivered.
 *
 * @category constructors
 * @since 0.0.0
 */
export const make = Effect.fnUntraced(function* (options: {
  readonly handler: ResultHandler
  /** Retries applied to a failing handler before giving up on the ACK. */
  readonly handlerRetry: Schedule.Schedule<unknown>
  /** How many results may wait for the handler. */
  readonly bufferSize: number
  readonly dedup: Dedup
}) {
  const { dedup } = options
  const queue = yield* Queue.bounded<Queued>(options.bufferSize)
  const counters = yield* Ref.make<Counters>({ delivered: 0, duplicates: 0 })

  const redeliver = Effect.fnUntraced(function* (queued: Queued) {
    yield* Ref.update(counters, (current) => ({ ...current, duplicates: current.duplicates + 1 }))
    yield* Effect.logDebug("received a duplicate result").pipe(
      Effect.annotateLogs({ deviceId: queued.value.deviceId, tighteningId: queued.value.tighteningId })
    )
    yield* queued.ack
  })

  const handle = (queued: Queued): Effect.Effect<void> =>
    pipe(
      options.handler(queued.value),
      Effect.retry(options.handlerRetry),
      Effect.matchCauseEffect({
        onFailure: (cause: Cause.Cause<unknown>) =>
          Effect.logError("the result handler failed, not acknowledging", cause).pipe(
            Effect.annotateLogs({ deviceId: queued.value.deviceId, tighteningId: queued.value.tighteningId })
          ),
        onSuccess: Effect.fnUntraced(function* () {
          yield* dedup.remember(queued.value.tighteningId)
          yield* Ref.update(counters, (current) => ({ ...current, delivered: current.delivered + 1 }))
          yield* queued.ack
        })
      })
    )

  const deliver = (queued: Queued): Effect.Effect<void> =>
    Effect.flatMap(dedup.seen(queued.value.tighteningId), (duplicate) =>
      duplicate ? redeliver(queued) : handle(queued)
    )

  yield* Queue.take(queue).pipe(Effect.flatMap(deliver), Effect.forever, Effect.forkChild)

  const enqueue = (queued: Queued): Effect.Effect<void> => Effect.orDie(Queue.offer(queue, queued))

  return {
    submitPushed: (pushed) => enqueue({ value: pushed.value, ack: acknowledge(pushed) }),
    submitRecovered: (result) => enqueue({ value: result, ack: Effect.void }),
    delivered: Effect.map(Ref.get(counters), (current) => current.delivered),
    duplicates: Effect.map(Ref.get(counters), (current) => current.duplicates)
  } satisfies ResultDelivery
})
