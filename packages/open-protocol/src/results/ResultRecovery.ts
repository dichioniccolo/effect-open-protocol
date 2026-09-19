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
import { Data, Effect, pipe } from "effect"
import * as A from "effect/Array"
import * as O from "effect/Option"
import type { CommandRejected } from "../connection/ConnectionError.ts"
import type { RequestError } from "../connection/RequestReply.ts"
import { TighteningId, type TighteningResult } from "../protocol/TighteningResult.ts"
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
  /** Undelivered identifiers left for the next pass because the gap exceeded the limit. */
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
  /** `silent` when nothing came back at all, as opposed to a refusal or a reply for another identifier. */
  Pending: { readonly id: TighteningId; readonly silent: boolean }
}>

const Attempt = Data.taggedEnum<Attempt>()

/** Sorts the attempts of a pass into its report. */
const summarize = (attempts: ReadonlyArray<Attempt>, skipped: number): Recovery => {
  const of = (tag: Attempt["_tag"]): ReadonlyArray<TighteningId> =>
    A.map(A.filter(attempts, Attempt.$is(tag)), (found) => found.id)

  return { recovered: of("Recovered"), missing: of("Missing"), pending: of("Pending"), skipped }
}

/** Requests in a row that may go unanswered before a pass stops asking. */
const silenceLimit = 3

/** The MID 0004 code for "Tightening ID requested not found": the only refusal that means the result is gone. */
const notFound = 15

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
  /**
   * Fetches one stored result. The failure that matters is `CommandRejected`
   * with code 15, the controller's own "I do not have it".
   */
  readonly request: (id: TighteningId) => Effect.Effect<TighteningResult, RequestError>
  readonly submit: (result: TighteningResult) => Effect.Effect<void>
  /**
   * Most missed results fetched in one pass. The remainder is reported as
   * `skipped`, for the caller to fetch with the next pass.
   */
  readonly limit: number
}) {
  const { limit } = options

  /**
   * Asks for one stored result. Only "not found" is final, and the identifier
   * is then written off so it stops holding the watermark back; any other
   * refusal or silence is retried. A reply for another identifier answers an
   * earlier request that timed out: it is still a stored result, so it is
   * delivered, and this identifier is asked for again.
   */
  const attempt = Effect.fnUntraced(
    function* (id: TighteningId) {
      const result = yield* options.request(id)
      yield* options.submit(result)

      return result.tighteningId === id ? Attempt.Recovered({ id }) : Attempt.Pending({ id, silent: false })
    },
    (effect, id) =>
      Effect.catchTag(effect, "CommandRejected", (rejected): Effect.Effect<Attempt> =>
        rejected.code === notFound
          ? Effect.as(options.dedup.remember(id), Attempt.Missing({ id }))
          : Effect.succeed(Attempt.Pending({ id, silent: false }))
      ),
    (effect, id) =>
      Effect.catchCause(effect, (cause) =>
        Effect.as(
          Effect.logDebug(`could not recover tightening ${id} yet`, cause),
          Attempt.Pending({ id, silent: true })
        )
      )
  )

  /** The latest result, for the baseline: `None` when the controller holds nothing. */
  const fetch = (id: TighteningId): Effect.Effect<O.Option<TighteningResult>, Exclude<RequestError, CommandRejected>> =>
    Effect.catchTag(Effect.asSome(options.request(id)), "CommandRejected", () => Effect.succeedNone)

  /**
   * Asks for `ids` in turn, and stops once `silenceLimit` requests in a row get
   * no answer at all: the link is gone for now, and waiting out every
   * remaining timeout would hold the pass for minutes. What was not asked for
   * is reported pending, for the next pass.
   */
  const attemptAll = (
    ids: ReadonlyArray<TighteningId>,
    silentInARow = 0,
    done: ReadonlyArray<Attempt> = []
  ): Effect.Effect<ReadonlyArray<Attempt>> =>
    O.match(A.head(ids), {
      onNone: () => Effect.succeed(done),
      onSome: (id) =>
        silentInARow >= silenceLimit
          ? Effect.succeed(
              A.appendAll(
                done,
                A.map(ids, (rest) => Attempt.Pending({ id: rest, silent: true }))
              )
            )
          : Effect.flatMap(attempt(id), (outcome) =>
              attemptAll(
                A.drop(ids, 1),
                Attempt.$is("Pending")(outcome) && outcome.silent ? silentInARow + 1 : 0,
                A.append(done, outcome)
              )
            )
    })

  const fetchRange = Effect.fnUntraced(function* (from: number, to: number) {
    // What was already delivered, or is on its way to the handler, is not
    // asked for again, so one hole that keeps failing cannot pin the window on
    // the same block.
    const unseen = yield* Effect.filter(
      to < from ? [] : A.map(A.range(from, to), (value) => TighteningId.make(value)),
      (id) => Effect.map(options.dedup.known(id), (known) => !known)
    )

    const wanted = A.take(unseen, limit)

    return summarize(yield* attemptAll(wanted), A.length(unseen) - A.length(wanted))
  })

  /** Up to `limit` undelivered identifiers from `id` down, highest first, stopping below 1. */
  const undeliveredBelow = (
    id: number,
    found: ReadonlyArray<TighteningId>
  ): Effect.Effect<ReadonlyArray<TighteningId>> =>
    id < 1 || A.length(found) === limit
      ? Effect.succeed(found)
      : Effect.flatMap(options.dedup.known(TighteningId.make(id)), (known) =>
          undeliveredBelow(id - 1, known ? found : A.append(found, TighteningId.make(id)))
        )

  /**
   * Finds where the results of a controller that was empty when first asked
   * start. Everything it holds was produced while we were listening, so the
   * pass walks down from `newest` a block of `limit` undelivered identifiers at
   * a time, fetched in ascending order. The highest "not found", or reaching
   * identifier 1, is the floor that becomes the baseline; until then the walk
   * is reported unfinished as `skipped`.
   */
  const findFloor = Effect.fnUntraced(function* (newest: TighteningId) {
    const block = A.reverse(yield* undeliveredBelow(newest, []))
    const attempts = yield* attemptAll(block)
    const floor = A.last(A.filter(attempts, Attempt.$is("Missing")))
    const bottomReached = A.length(block) < limit

    yield* O.match(floor, {
      onNone: () => (bottomReached ? options.dedup.markBaseline(TighteningId.make(0)) : Effect.void),
      onSome: (missing) => options.dedup.markBaseline(missing.id)
    })

    return summarize(attempts, O.isNone(floor) && !bottomReached ? 1 : 0)
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
          wasEmpty ? findFloor(id) : Effect.as(options.dedup.markBaseline(id), nothing)
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
      O.match(latest, {
        // No answer says nothing about what the controller holds, so the pass
        // reports it pending instead of concluding there is nothing to fetch.
        onNone: () => Effect.succeed(unanswered),
        onSome: (answer) => {
          const newest = O.getOrElse(answer, () => delivered)

          return newest <= delivered ? Effect.succeed(nothing) : fetchRange(delivered + 1, newest)
        }
      })
  })
})
