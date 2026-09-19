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
  /** How long opening the connection may take before the attempt fails. Defaults to 10 seconds. */
  readonly connectTimeout?: Duration.Duration | undefined
  /** Idle time before a keep-alive is sent. Defaults to 10 seconds. */
  readonly keepAliveInterval?: Duration.Duration | undefined
  /** How long to wait for a reply before declaring the session dead. Defaults to 5 seconds. */
  readonly responseTimeout?: Duration.Duration | undefined
  /** Called for every result the controller pushes. Subscribing is skipped when absent. */
  readonly onResult?: ResultHandler | undefined
  /** Retries applied to a failing handler before the acknowledgement is skipped. Defaults to three, jittered exponential. */
  readonly handlerRetry?: Schedule.Schedule<unknown> | undefined
  /** How many results may wait for a slow handler. Defaults to 16. */
  readonly resultBuffer?: number | undefined
  /** How many pushed values a subscription holds for a slow consumer. Defaults to 16. */
  readonly subscriptionBuffer?: number | undefined
  /** How many identifiers the duplicate detector remembers. Defaults to 1000. */
  readonly dedupCapacity?: number | undefined
  /** How many results one recovery pass fetches before the next pass takes over. Defaults to 100. */
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
   * while the session is up, costing one MID 0064 per interval.
   *
   * Off unless set. Recovery normally needs no timer: it runs when a session
   * starts and whenever a pushed identifier reveals a gap. A timer only adds
   * the case where results were missed, the session never dropped, and no
   * further tightening ever arrives to reveal it. Polling a controller for
   * that costs traffic on every device, every interval, forever, so it is the
   * caller's call to make.
   */
  readonly recoveryInterval?: Duration.Duration | undefined
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
 * The knobs that have a default, and what they fall back to.
 *
 * Every default lives here once: `DeviceSettings` is derived from these keys,
 * so a new knob cannot be declared resolved without being resolved.
 *
 * @category constants
 * @since 0.0.0
 */
export const defaultSettings = {
  reconnect: defaultReconnect,
  connectTimeout: Duration.seconds(10),
  keepAliveInterval: Duration.seconds(10),
  responseTimeout: Duration.seconds(5),
  stopTimeout: Duration.seconds(1),
  recoveryAttempts: 5,
  recoveryRetryDelay: Duration.millis(500),
  recoveryTimeout: Duration.seconds(1),
  handlerRetry: defaultHandlerRetry,
  resultBuffer: 16,
  subscriptionBuffer: 16,
  dedupCapacity: 1000,
  recoveryLimit: 100
}

/** The knobs `defaultSettings` answers for; `Pick` refuses a key `DeviceConfig` does not have. */
type Defaulted = keyof typeof defaultSettings

/**
 * A `DeviceConfig` with every default filled in.
 *
 * @category models
 * @since 0.0.0
 */
export interface DeviceSettings extends Omit<DeviceConfig, Defaulted>, Required<Pick<DeviceConfig, Defaulted>> {}

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
  // Key by key on purpose: `{ ...defaultSettings, ...config }` would let an
  // explicit `undefined` erase a default, and the config carries a Schedule
  // and a handler, so it cannot hold its defaults as a schema.
  ...config,
  reconnect: config.reconnect ?? defaultSettings.reconnect,
  connectTimeout: config.connectTimeout ?? defaultSettings.connectTimeout,
  keepAliveInterval: config.keepAliveInterval ?? defaultSettings.keepAliveInterval,
  responseTimeout: config.responseTimeout ?? defaultSettings.responseTimeout,
  stopTimeout: config.stopTimeout ?? defaultSettings.stopTimeout,
  recoveryAttempts: config.recoveryAttempts ?? defaultSettings.recoveryAttempts,
  recoveryRetryDelay: config.recoveryRetryDelay ?? defaultSettings.recoveryRetryDelay,
  recoveryTimeout: config.recoveryTimeout ?? defaultSettings.recoveryTimeout,
  handlerRetry: config.handlerRetry ?? defaultSettings.handlerRetry,
  resultBuffer: config.resultBuffer ?? defaultSettings.resultBuffer,
  subscriptionBuffer: config.subscriptionBuffer ?? defaultSettings.subscriptionBuffer,
  dedupCapacity: config.dedupCapacity ?? defaultSettings.dedupCapacity,
  recoveryLimit: config.recoveryLimit ?? defaultSettings.recoveryLimit
})
