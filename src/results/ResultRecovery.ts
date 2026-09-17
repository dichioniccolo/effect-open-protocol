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
 * How a recovery pass went.
 *
 * `missing` and `pending` mean different things, and the difference decides
 * whether a result is lost. The controller answering "I do not have it" is
 * final. A request that timed out or died with the session is not: the result
 * may still be there, so the pass reports it as pending and the caller tries
 * again.
 *
 * @category models
 * @since 0.0.0
 */
export interface Recovery {
  /** Identifiers that were fetched and submitted for delivery. */
  readonly recovered: ReadonlyArray<TighteningId>
  /** Identifiers the controller no longer holds. */
  readonly missing: ReadonlyArray<TighteningId>
  /** Identifiers that could not be fetched this time and deserve another attempt. */
  readonly pending: ReadonlyArray<TighteningId>
  /** Identifiers left unfetched because the gap exceeded the limit. */
  readonly skipped: number
}

/** What became of one requested identifier. */
type Attempt =
  | { readonly _tag: "Recovered"; readonly id: TighteningId }
  | { readonly _tag: "Missing"; readonly id: TighteningId }
  | { readonly _tag: "Pending"; readonly id: TighteningId }

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

  // A controller with nothing stored answers MID 0064 with an error; that is a
  // legitimate "no history", not a recovery failure.
  const latest = yield* pipe(
    fetch(TighteningId.make(0)),
    Effect.map(O.map((result) => result.tighteningId)),
    Effect.catchCause(() => Effect.succeed(O.none<TighteningId>()))
  )
  const since = yield* options.dedup.lastDelivered

  return yield* O.match(since, {
    // First connection: everything the controller already holds is history, so
    // only the starting point is recorded. Later reconnects always have a
    // baseline and therefore fetch the gap.
    onNone: () =>
      pipe(
        // Identifiers do not start at zero, and asking for "the latest" can
        // fail. When it does, no baseline is recorded: the first result that
        // reaches the handler sets it instead. Assuming zero here would turn
        // a controller counting in the millions into a millions-wide gap.
        O.match(latest, {
          onNone: () => Effect.void,
          onSome: (id) => options.dedup.markBaseline(id)
        }),
        Effect.as<Recovery>({ recovered: [], missing: [], pending: [], skipped: 0 })
      ),
    onSome: (delivered) =>
      Effect.gen(function* () {
        const newest = yield* Effect.map(
          O.match(latest, {
            onNone: () => Effect.succeed(O.none<TighteningId>()),
            onSome: (id) => Effect.succeed(O.some(id))
          }),
          O.getOrElse(() => TighteningId.make(delivered))
        )
        const gap = newest <= delivered ? [] : A.range(delivered + 1, newest)
        const wanted = A.take(gap, limit)
        // One failed request must not end the pass: a later identifier may
        // still be reachable, and everything unfetched is reported as pending.
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
              Effect.map((found) =>
                O.match(found, {
                  onNone: (): Attempt => ({ _tag: "Missing", id: TighteningId.make(value) }),
                  onSome: (): Attempt => ({ _tag: "Recovered", id: TighteningId.make(value) })
                })
              ),
              Effect.catchCause((cause) =>
                pipe(
                  Effect.logDebug(`could not recover tightening ${value} yet`, cause),
                  Effect.as<Attempt>({ _tag: "Pending", id: TighteningId.make(value) })
                )
              )
            )
        )
        const of = (tag: Attempt["_tag"]): ReadonlyArray<TighteningId> =>
          A.getSomes(A.map(fetched, (attempt) => attempt._tag === tag ? O.some(attempt.id) : O.none()))
        return {
          recovered: of("Recovered"),
          missing: of("Missing"),
          pending: of("Pending"),
          skipped: A.length(gap) - A.length(wanted)
        } satisfies Recovery
      })
  })
})
