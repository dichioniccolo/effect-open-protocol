/**
 * Putting a slow link between two ends that share a process.
 *
 * Latency is a property of the wire, not of either program, so it belongs at
 * the same `Duplex` boundary the trace does. Each side delays only what it
 * writes: a round trip is then the sum of two one-way delays, and neither side
 * has to know what the other is doing. Delays come from the ambient `Random`,
 * so a run under `Random.withSeed` replays exactly.
 *
 * @since 0.0.0
 */
import { Duration, Effect, pipe, Random } from "effect"
import type { Duplex } from "./Transport.ts"

/**
 * How slow the link should be.
 *
 * @category models
 * @since 0.0.0
 */
export interface LatencyOptions {
  /** Delay applied to every write. */
  readonly latency: Duration.Duration
  /** Spread around `latency`; the delay lands in `latency ± jitter`, never below zero. */
  readonly jitter: Duration.Duration
}

/**
 * Draws one delay from `latency ± jitter`.
 *
 * @category constructors
 * @since 0.0.0
 */
export const nextDelay = (options: LatencyOptions): Effect.Effect<Duration.Duration> => {
  const centre = Duration.toMillis(options.latency)
  const spread = Duration.toMillis(options.jitter)
  return spread <= 0
    ? Effect.succeed(Duration.millis(Math.max(0, centre)))
    : Effect.map(
      Random.nextIntBetween(0, spread * 2 + 1),
      (offset) => Duration.millis(Math.max(0, centre - spread + offset))
    )
}

/**
 * Wraps a `Duplex` so every write waits before it reaches the wire.
 *
 * Reads are left alone on purpose. When both ends wear this decorator, delaying
 * reads as well would count the same link twice.
 *
 * **Example** (A client on a 50ms link)
 *
 * ```ts
 * import { Duration, Effect } from "effect"
 * import { Endpoint, Transport, delayedDuplex } from "effect-open-protocol"
 *
 * const program = Effect.gen(function* () {
 *   const transport = yield* Transport
 *   const duplex = yield* transport.connect(new Endpoint({ host: "10.0.0.31", port: 4545 }))
 *   return delayedDuplex(duplex, {
 *     latency: Duration.millis(50),
 *     jitter: Duration.millis(10)
 *   })
 * })
 * ```
 *
 * @category constructors
 * @since 0.0.0
 */
export const delayedDuplex = (duplex: Duplex, options: LatencyOptions): Duplex =>
  Duration.toMillis(options.latency) <= 0 && Duration.toMillis(options.jitter) <= 0
    ? duplex
    : {
      incoming: duplex.incoming,
      send: (bytes) =>
        pipe(
          nextDelay(options),
          Effect.flatMap(Effect.sleep),
          Effect.andThen(duplex.send(bytes))
        )
    }
