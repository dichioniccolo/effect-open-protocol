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
 * is sent only after the application has taken responsibility for it.
 *
 * @since 0.0.0
 */
import { Cause, Duration, Effect, pipe, Queue, Ref, Schedule } from "effect"
import type { TighteningResult } from "../protocol/TighteningResult.ts"
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
 * How results are delivered.
 *
 * @category models
 * @since 0.0.0
 */
export interface DeliveryOptions {
  readonly handler: ResultHandler
  /** Retries applied to a failing handler before giving up on the ACK. */
  readonly handlerRetry?: Schedule.Schedule<unknown> | undefined
  /** How many results may wait for the handler. */
  readonly bufferSize?: number | undefined
}

/**
 * Retries a failing handler three times with jittered exponential backoff.
 *
 * Handler failures are expensive here: a result the controller gives up on is
 * gone for good, so a transient application error should not cost traceability
 * data.
 *
 * @category constants
 * @since 0.0.0
 */
export const defaultHandlerRetry: Schedule.Schedule<Duration.Duration> = pipe(
  Schedule.exponential(Duration.millis(200)),
  Schedule.jittered,
  Schedule.upTo({ times: 3 })
)

/**
 * Default number of results waiting for a slow handler.
 *
 * @category constants
 * @since 0.0.0
 */
export const defaultBufferSize = 16

/**
 * A running delivery pipeline for one device.
 *
 * @category models
 * @since 0.0.0
 */
export interface ResultDelivery {
  /** Enqueues a result; waits when the buffer is full (backpressure). */
  readonly submit: (result: TighteningResult) => Effect.Effect<void>
  /** Results handed to the handler, duplicates excluded. */
  readonly delivered: Effect.Effect<number>
  /** Results recognised as resends of something already delivered. */
  readonly duplicates: Effect.Effect<number>
}

interface Counters {
  readonly delivered: number
  readonly duplicates: number
}

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
  submit: (result) =>
    Effect.logDebug("dropping a result: no handler is configured").pipe(
      Effect.annotateLogs({ deviceId: result.deviceId, tighteningId: result.tighteningId })
    ),
  delivered: Effect.succeed(0),
  duplicates: Effect.succeed(0)
}

/**
 * Starts the delivery loop for a device, for the lifetime of the calling scope.
 *
 * `acknowledge` is called only after the handler succeeded, or immediately for
 * a duplicate whose earlier acknowledgement never reached the controller.
 * `dedup` is the device's window, shared with its gap recovery so both see
 * the same record of what was delivered.
 *
 * @category constructors
 * @since 0.0.0
 */
export const make = Effect.fnUntraced(function* (options: {
  readonly delivery: DeliveryOptions
  readonly dedup: Dedup
  readonly acknowledge: (result: TighteningResult) => Effect.Effect<void, unknown>
}) {
  const dedup = options.dedup
  const queue = yield* Queue.bounded<TighteningResult>(options.delivery.bufferSize ?? defaultBufferSize)
  const counters = yield* Ref.make<Counters>({ delivered: 0, duplicates: 0 })
  const retry = options.delivery.handlerRetry ?? defaultHandlerRetry

  const acknowledge = (result: TighteningResult): Effect.Effect<void> =>
    pipe(
      options.acknowledge(result),
      Effect.catchCause((cause) =>
        Effect.logWarning("could not acknowledge a result", cause).pipe(
          Effect.annotateLogs({ deviceId: result.deviceId, tighteningId: result.tighteningId })
        )
      )
    )

  const redeliver = Effect.fnUntraced(function* (result: TighteningResult) {
    yield* Ref.update(counters, (current) => ({ ...current, duplicates: current.duplicates + 1 }))
    yield* Effect.logDebug("acknowledging a duplicate result").pipe(
      Effect.annotateLogs({ deviceId: result.deviceId, tighteningId: result.tighteningId })
    )
    yield* acknowledge(result)
  })

  const handle = (result: TighteningResult): Effect.Effect<void> =>
    pipe(
      options.delivery.handler(result),
      Effect.retry(retry),
      Effect.matchCauseEffect({
        onFailure: (cause: Cause.Cause<unknown>) =>
          Effect.logError("the result handler failed, not acknowledging", cause).pipe(
            Effect.annotateLogs({ deviceId: result.deviceId, tighteningId: result.tighteningId })
          ),
        onSuccess: Effect.fnUntraced(function* () {
          yield* dedup.remember(result.tighteningId)
          yield* Ref.update(counters, (current) => ({ ...current, delivered: current.delivered + 1 }))
          yield* acknowledge(result)
        })
      })
    )

  const deliver = (result: TighteningResult): Effect.Effect<void> =>
    Effect.flatMap(dedup.seen(result.tighteningId), (duplicate) => (duplicate ? redeliver(result) : handle(result)))

  yield* Queue.take(queue).pipe(Effect.flatMap(deliver), Effect.forever, Effect.forkChild)

  return {
    submit: (result) => Effect.orDie(Queue.offer(queue, result)),
    delivered: Effect.map(Ref.get(counters), (current) => current.delivered),
    duplicates: Effect.map(Ref.get(counters), (current) => current.duplicates)
  } satisfies ResultDelivery
})
