/**
 * Fetching the results that were produced while the connection was down.
 *
 * The controller gives up on a result it cannot acknowledge, so reconnecting
 * is not enough to get it back: it must be asked for by identifier. MID 0064
 * requests a stored result (`0` means "the latest one") and MID 0065 returns
 * it, which is what lets a chaos run still end with zero lost results.
 *
 * @since 0.0.0
 */
import { Effect, pipe } from "effect"
import * as A from "effect/Array"
import * as O from "effect/Option"
import { type Message, RequestOldResult } from "../protocol/Messages.ts"
import { TighteningId, type TighteningResult } from "../protocol/TighteningResult.ts"
import type { Dedup } from "./Dedup.ts"

/**
 * Default number of missed results fetched after a reconnect.
 *
 * A device that was offline for a long time must not stall its own recovery,
 * so the gap is capped and the remainder is reported.
 *
 * @category constants
 * @since 0.0.0
 */
export const defaultRecoveryLimit = 100

/**
 * How a recovery run went.
 *
 * @category models
 * @since 0.0.0
 */
export interface Recovery {
  /** Identifiers that were fetched and submitted for delivery. */
  readonly recovered: ReadonlyArray<TighteningId>
  /** Identifiers inside the gap the controller no longer had. */
  readonly missing: ReadonlyArray<TighteningId>
  /** Identifiers left unfetched because the gap exceeded the limit. */
  readonly skipped: number
}

const resultOf = (message: Message): O.Option<TighteningResult> =>
  message._tag === "OldResult" ? O.some(message.result) : O.none()

/**
 * Asks the controller for everything produced since the last delivered result.
 *
 * On a first connection there is no baseline, so the controller's latest
 * identifier is recorded without replaying history.
 *
 * @category constructors
 * @since 0.0.0
 */
export const run = Effect.fnUntraced(function* (options: {
  readonly dedup: Dedup
  readonly request: (message: Message, mid: number) => Effect.Effect<Message, unknown>
  readonly submit: (result: TighteningResult) => Effect.Effect<void>
  readonly limit?: number | undefined
}) {
  const limit = options.limit ?? defaultRecoveryLimit
  const fetch = (id: TighteningId): Effect.Effect<O.Option<TighteningResult>, unknown> =>
    Effect.map(options.request(new RequestOldResult({ tighteningId: id }), 64), resultOf)

  const latest = yield* Effect.map(fetch(TighteningId.make(0)), O.map((result) => result.tighteningId))
  const since = yield* options.dedup.lastDelivered

  return yield* O.match(O.all([latest, since]), {
    onNone: () =>
      pipe(
        O.match(latest, {
          onNone: () => Effect.void,
          onSome: (id) => options.dedup.remember(id)
        }),
        Effect.as<Recovery>({ recovered: [], missing: [], skipped: 0 })
      ),
    onSome: ([newest, delivered]) =>
      Effect.gen(function* () {
        const gap = A.range(delivered + 1, newest)
        const wanted = A.take(gap, limit)
        const fetched = yield* Effect.forEach(
          wanted,
          (value) =>
            pipe(
              fetch(TighteningId.make(value)),
              Effect.tap((found) =>
                O.match(found, {
                  onNone: () => Effect.void,
                  onSome: (result) => options.submit(result)
                })
              ),
              Effect.catchCause((cause) =>
                Effect.as(
                  Effect.logWarning(`could not recover tightening ${value}`, cause),
                  O.none<TighteningResult>()
                )
              ),
              Effect.map((found) => ({ id: TighteningId.make(value), found }))
            )
        )
        return {
          recovered: A.getSomes(A.map(fetched, ({ found, id }) => O.map(found, () => id))),
          missing: A.getSomes(
            A.map(fetched, ({ found, id }) => O.isNone(found) ? O.some(id) : O.none<TighteningId>())
          ),
          skipped: A.length(gap) - A.length(wanted)
        } satisfies Recovery
      })
  })
})
