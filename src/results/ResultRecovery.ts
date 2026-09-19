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
import { Data, Effect, pipe, Predicate } from "effect"
import * as A from "effect/Array"
import * as O from "effect/Option"
import type { CommandRejected, RequestTimeout } from "../connection/ConnectionError.ts"
import { type Message, RequestOldResult } from "../protocol/Messages.ts"
import { TighteningId, type TighteningResult } from "../protocol/TighteningResult.ts"
import type { ConnectionLost } from "../transport/Transport.ts"
import type { Dedup } from "./Dedup.ts"

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

/**
 * Stands for the baseline lookup itself when it goes unanswered, so the caller
 * retries instead of mistaking silence for "there is no history".
 */
const pendingBaseline = TighteningId.make(0)

const nothing: Recovery = { recovered: [], missing: [], pending: [], skipped: 0 }

const unanswered: Recovery = { recovered: [], missing: [], pending: [pendingBaseline], skipped: 0 }

/** What became of one requested identifier. */
type Attempt = Data.TaggedEnum<{
  Recovered: { readonly id: TighteningId }
  Missing: { readonly id: TighteningId }
  Pending: { readonly id: TighteningId }
}>

const Attempt = Data.taggedEnum<Attempt>()

const resultOf = (message: Message): O.Option<TighteningResult> =>
  Predicate.isTagged(message, "OldResult") ? O.some(message.result) : O.none()

/**
 * Everything a recovery request can fail with. The distinction that matters is
 * `CommandRejected`, the controller's own "I do not have it".
 *
 * @category models
 * @since 0.0.0
 */
export type RecoveryFailure = CommandRejected | RequestTimeout | ConnectionLost

/**
 * Asks the controller for everything produced since the last delivered result.
 *
 * The starting point is the difficult part. A controller does not count from
 * zero, it can be asked while it holds nothing, and it can fail to answer at
 * all. Those three cases are kept apart: an answer sets the baseline, an empty
 * controller means everything from now on is ours to collect, and silence is
 * retried rather than mistaken for either.
 *
 * @category constructors
 * @since 0.0.0
 */
export const runRecovery = Effect.fnUntraced(function* (options: {
  readonly dedup: Dedup
  readonly request: (message: Message, mid: number) => Effect.Effect<Message, RecoveryFailure>
  readonly submit: (result: TighteningResult) => Effect.Effect<void>
  /**
   * Most missed results fetched in one pass. A device that was offline for a
   * long time must not stall its own recovery, so the gap is capped and the
   * remainder is reported.
   */
  readonly limit: number
}) {
  const { limit } = options

  /**
   * Asks for one stored result. A controller answering "I do not have it" is
   * an answer (`None`); anything else is silence, and silence is retried.
   */
  const fetch = (id: TighteningId): Effect.Effect<O.Option<TighteningResult>, RequestTimeout | ConnectionLost> =>
    pipe(
      options.request(new RequestOldResult({ tighteningId: id }), 64),
      Effect.map(resultOf),
      Effect.catchTag("CommandRejected", () => Effect.succeed(O.none<TighteningResult>()))
    )

  const fetchRange = (from: number, to: number): Effect.Effect<Recovery> =>
    Effect.suspend(() => {
      const gap = to < from ? [] : A.range(from, to)
      const wanted = A.take(gap, limit)

      // One failed request must not end the pass: a later identifier may still
      // be reachable, and everything unfetched is reported as pending.
      return Effect.map(
        Effect.forEach(wanted, (value) =>
          pipe(
            fetch(TighteningId.make(value)),
            Effect.tap((found) =>
              O.match(found, {
                onNone: () => Effect.void,
                onSome: (result) => options.submit(result)
              })
            ),
            Effect.map((found) =>
              O.isSome(found)
                ? Attempt.Recovered({ id: TighteningId.make(value) })
                : Attempt.Missing({ id: TighteningId.make(value) })
            ),
            Effect.catchCause((cause) =>
              Effect.as(
                Effect.logDebug(`could not recover tightening ${value} yet`, cause),
                Attempt.Pending({ id: TighteningId.make(value) })
              )
            )
          )
        ),
        (attempts: ReadonlyArray<Attempt>) => {
          const of = (tag: Attempt["_tag"]): ReadonlyArray<TighteningId> =>
            A.getSomes(A.map(attempts, (attempt) => (Attempt.$is(tag)(attempt) ? O.some(attempt.id) : O.none())))

          return {
            recovered: of("Recovered"),
            missing: of("Missing"),
            pending: of("Pending"),
            skipped: A.length(gap) - A.length(wanted)
          } satisfies Recovery
        }
      )
    })

  // The outer Option is "did the controller answer at all"; the inner one is
  // "does it hold anything".
  const latest = yield* pipe(
    fetch(pendingBaseline),
    Effect.map((found) => O.some(O.map(found, (result) => result.tighteningId))),
    Effect.catchCause(() => Effect.succeed(O.none<O.Option<TighteningId>>()))
  )

  const since = yield* options.dedup.lastDelivered

  const firstContact = (answer: O.Option<TighteningId>): Effect.Effect<Recovery> =>
    O.match(answer, {
      onNone: () => Effect.as(options.dedup.markNoHistory, nothing),
      onSome: (id) =>
        Effect.flatMap(options.dedup.sawEmptyHistory, (wasEmpty) =>
          // The controller was empty when we first looked, so everything it
          // holds now was produced while we were listening. None of it is
          // history, however little of it we managed to receive.
          wasEmpty ? fetchRange(Math.max(1, id - limit + 1), id) : Effect.as(options.dedup.markBaseline(id), nothing)
        )
    })

  return yield* O.match(since, {
    onNone: () =>
      O.match(latest, {
        onNone: (): Effect.Effect<Recovery> =>
          Effect.as(Effect.logDebug("no baseline yet: the controller has not answered"), unanswered),
        onSome: firstContact
      }),
    onSome: (delivered) =>
      Effect.suspend(() => {
        const newest = O.getOrElse(O.flatten(latest), () => TighteningId.make(delivered))

        return newest <= delivered ? Effect.succeed(nothing) : fetchRange(delivered + 1, newest)
      })
  })
})
