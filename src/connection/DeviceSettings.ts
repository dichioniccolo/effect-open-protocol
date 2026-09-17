/**
 * What an application asks for, and what the connection actually runs with.
 *
 * Every knob of a device connection is optional and every default follows the
 * Open Protocol specification. Resolving them once, here, keeps the lifecycle
 * code free of `??` and gives the rest of the connection one record to read.
 *
 * @since 0.0.0
 */
import { Duration, Effect, pipe, Schedule } from "effect"
import type { DeviceId } from "../protocol/TighteningResult.ts"
import type { ResultHandler } from "../results/ResultDelivery.ts"
import type { Endpoint } from "../transport/Transport.ts"

/**
 * How one device should be connected and kept alive.
 *
 * Defaults follow the Open Protocol specification: the controller drops a
 * connection after 15 seconds without traffic, so a keep-alive goes out after
 * 10 seconds of silence.
 *
 * @category models
 * @since 0.0.0
 */
export interface DeviceConfig {
  readonly id: DeviceId
  readonly endpoint: Endpoint
  /** Backoff between connection attempts. Defaults to jittered exponential, capped at 30 seconds. */
  readonly reconnect?: Schedule.Schedule<unknown> | undefined
  /** Idle time before a keep-alive is sent. Defaults to 10 seconds. */
  readonly keepAliveInterval?: Duration.Duration | undefined
  /** How long to wait for a reply before declaring the session dead. Defaults to 5 seconds. */
  readonly responseTimeout?: Duration.Duration | undefined
  /** Called for every result the controller pushes. Subscribing is skipped when absent. */
  readonly onResult?: ResultHandler | undefined
  /** Retries applied to a failing handler before the acknowledgement is skipped. */
  readonly handlerRetry?: Schedule.Schedule<unknown> | undefined
  /** How many results may wait for a slow handler. Defaults to 16. */
  readonly resultBuffer?: number | undefined
  /** How many identifiers the duplicate detector remembers. Defaults to 1000. */
  readonly dedupCapacity?: number | undefined
  /** Upper bound on results fetched after an outage. Defaults to 100. */
  readonly recoveryLimit?: number | undefined
  /** How long a graceful close waits for the communication stop to flush. Defaults to 1 second. */
  readonly stopTimeout?: Duration.Duration | undefined
  /** How many times a recovery pass retries the identifiers it could not fetch. Defaults to 5. */
  readonly recoveryAttempts?: number | undefined
  /** How long to wait between recovery passes. Defaults to 500 milliseconds. */
  readonly recoveryRetryDelay?: Duration.Duration | undefined
  /** How long a single recovery request waits for its reply. Defaults to 1 second. */
  readonly recoveryTimeout?: Duration.Duration | undefined
  /**
   * How often the connection reconciles with the controller's latest result
   * while the session is up. One MID 0064 per interval. Defaults to 5 seconds.
   */
  readonly recoveryInterval?: Duration.Duration | undefined
}

/**
 * A `DeviceConfig` with every default filled in.
 *
 * @category models
 * @since 0.0.0
 */
export interface DeviceSettings {
  readonly id: DeviceId
  readonly endpoint: Endpoint
  readonly reconnect: Schedule.Schedule<unknown>
  readonly keepAliveInterval: Duration.Duration
  readonly responseTimeout: Duration.Duration
  readonly stopTimeout: Duration.Duration
  readonly recoveryAttempts: number
  readonly recoveryRetryDelay: Duration.Duration
  readonly recoveryTimeout: Duration.Duration
  readonly recoveryInterval: Duration.Duration
  readonly recoveryLimit: number | undefined
  readonly onResult: ResultHandler | undefined
  readonly handlerRetry: Schedule.Schedule<unknown> | undefined
  readonly resultBuffer: number | undefined
  readonly dedupCapacity: number | undefined
}

/**
 * Jittered exponential backoff, capped at 30 seconds: the default gap between
 * connection attempts.
 *
 * @category constants
 * @since 0.0.0
 */
export const defaultReconnect: Schedule.Schedule<Duration.Duration> = pipe(
  Schedule.exponential("500 millis"),
  Schedule.modifyDelay(({ duration }) => Effect.succeed(Duration.min(duration, Duration.seconds(30)))),
  Schedule.jittered
)

/**
 * Fills in every default a device connection needs.
 *
 * **Example** (Reading the keep-alive a device will use)
 *
 * ```ts
 * import { DeviceId, Endpoint, resolveSettings } from "effect-open-protocol"
 *
 * const settings = resolveSettings({
 *   id: DeviceId.make("line-1-tool-3"),
 *   endpoint: new Endpoint({ host: "10.0.0.31", port: 4545 })
 * })
 *
 * console.log(settings.keepAliveInterval)
 * ```
 *
 * @category constructors
 * @since 0.0.0
 */
export const resolveSettings = (config: DeviceConfig): DeviceSettings => ({
  id: config.id,
  endpoint: config.endpoint,
  reconnect: config.reconnect ?? defaultReconnect,
  keepAliveInterval: config.keepAliveInterval ?? Duration.seconds(10),
  responseTimeout: config.responseTimeout ?? Duration.seconds(5),
  stopTimeout: config.stopTimeout ?? Duration.seconds(1),
  recoveryAttempts: config.recoveryAttempts ?? 5,
  recoveryRetryDelay: config.recoveryRetryDelay ?? Duration.millis(500),
  recoveryTimeout: config.recoveryTimeout ?? Duration.seconds(1),
  recoveryInterval: config.recoveryInterval ?? Duration.seconds(5),
  recoveryLimit: config.recoveryLimit,
  onResult: config.onResult,
  handlerRetry: config.handlerRetry,
  resultBuffer: config.resultBuffer,
  dedupCapacity: config.dedupCapacity
})
