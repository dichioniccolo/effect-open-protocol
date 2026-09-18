/**
 * The UI's state, as Effect atoms.
 *
 * The run list polls the server. A run's events live in one atom per run,
 * seeded with the page the server rendered and appended to by the live feed.
 * Filters and the selected packet are plain writable atoms, and what the
 * packet list shows is derived from them, so no component keeps its own copy.
 */
import { Duration, Effect, pipe, Queue, Schedule, Stream } from "effect"
import * as A from "effect/Array"
import * as DateTime from "effect/DateTime"
import * as O from "effect/Option"
import * as S from "effect/Schema"
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/unstable/http"
import * as Atom from "effect/unstable/reactivity/Atom"
import type { EventId, Run, RunId, StoredEvent } from "@wire-trace/store"
import { EventPageJson, Filters, midsOf, noFilters, RunListJson, visible } from "./wire"

const runtime = Atom.runtime(FetchHttpClient.layer)

/** How often the run list asks for fresh counts. */
const pollEvery = Duration.seconds(2)

/** A run with no end stamp and no event for this long has probably crashed. */
const quietAfter = Duration.seconds(30)

/** Where a run stands, as the run list shows it. */
export const RunStatus = S.Literals(["recording", "ended", "quiet"]).annotate({
  identifier: "RunStatus",
  description: "Recording now, cleanly ended, or unended but silent"
})

export type RunStatus = typeof RunStatus.Type

/** A listed run and where it stands at the time of the poll. */
export interface ListedRun {
  readonly run: Run
  readonly status: RunStatus
}

const statusAt = (now: DateTime.Utc) => (run: Run): RunStatus =>
  O.isSome(run.endedAt)
    ? "ended"
    : pipe(
      run.lastEventAt,
      O.orElse(() => O.some(run.startedAt)),
      O.flatMap(DateTime.make),
      O.exists((last) => Duration.isLessThan(DateTime.distance(last, now), quietAfter))
    )
    ? "recording"
    : "quiet"

/** Lists the runs with their status, stamped against the current time. */
export const listRuns = (runs: ReadonlyArray<Run>, now: DateTime.Utc): ReadonlyArray<ListedRun> =>
  A.map(runs, (run) => ({ run, status: statusAt(now)(run) }))

const fetchRuns = pipe(
  HttpClient.get("/api/runs"),
  Effect.flatMap(HttpClientResponse.filterStatusOk),
  Effect.flatMap((response) => response.text),
  Effect.flatMap(S.decodeEffect(RunListJson)),
  Effect.zipWith(DateTime.now, listRuns),
  // A server restart or a dropped request should cost one poll, not the list.
  Effect.retry(Schedule.spaced(pollEvery))
)

/**
 * Every recorded run, refreshed every couple of seconds.
 *
 * On the server it stays initial: the page renders the list it loaded itself,
 * and polling starts in the browser.
 */
export const runsAtom = runtime.atom(Stream.fromEffectSchedule(fetchRuns, Schedule.spaced(pollEvery))).pipe(
  Atom.withServerValueInitial
)

/** Every event of a run the browser has, oldest first. */
export const eventsAtom = Atom.family((_: RunId) => Atom.make<ReadonlyArray<StoredEvent>>([]).pipe(Atom.keepAlive))

/** The newest event id the browser holds for a run, or 0 before the first. */
const cursorOf = (events: ReadonlyArray<StoredEvent>): number =>
  O.getOrElse(O.map(A.last(events), (event) => event.id), () => 0)

/**
 * The pages of a run's events the server pushes, past `after`, as JSON text.
 * The connection opening arrives as `None`, so a quiet run still shows as
 * connected.
 */
const serverEvents = (runId: RunId, after: number): Stream.Stream<O.Option<string>> =>
  Stream.callback<O.Option<string>>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const source = new EventSource(`/api/runs/${runId}/live?after=${after}`)
        source.addEventListener("open", () => Queue.offerUnsafe(queue, O.none()))
        source.addEventListener("events", (message) => Queue.offerUnsafe(queue, O.some(message.data)))
        return source
      }),
      (source) => Effect.sync(() => source.close())
    )
  )

/**
 * The live feed of a run: while mounted, every event the server pushes is
 * appended to the run's events. Its own value is the size of the last page,
 * which is enough to show that the feed is connected.
 *
 * The feed resumes after the newest event already held, so the page the server
 * rendered is never fetched twice, and a reconnecting `EventSource` resumes
 * from the last id it saw.
 */
export const liveAtom = Atom.family((runId: RunId) =>
  Atom.make((get) => {
    const events = eventsAtom(runId)
    return pipe(
      serverEvents(runId, cursorOf(get.once(events))),
      Stream.mapEffect(O.match({
        onNone: () => Effect.succeed<ReadonlyArray<StoredEvent>>([]),
        onSome: (data) => S.decodeEffect(EventPageJson)(data)
      })),
      Stream.tap((page) =>
        Effect.sync(() =>
          get.registry.update(events, (held) => {
            const after = cursorOf(held)
            return A.appendAll(held, A.filter(page, (event) => event.id > after))
          })
        )
      ),
      Stream.map((page) => page.length)
    )
  }).pipe(Atom.withServerValueInitial)
)

/** The packet list filters. */
export const filtersAtom = Atom.make<Filters>(noFilters)

/** The packet whose detail is open. */
export const selectedAtom = Atom.make<O.Option<EventId>>(O.none())

/** What the packet list shows for a run under the current filters. */
export const visibleAtom = Atom.family((runId: RunId) =>
  Atom.make((get) => visible(get(eventsAtom(runId)), get(filtersAtom)))
)

/** Every MID seen in a run, for the MID filter. */
export const midsAtom = Atom.family((runId: RunId) => Atom.make((get) => midsOf(get(eventsAtom(runId)))))

/** The open packet of a run, if it is one of the run's events. */
export const selectedEventAtom = Atom.family((runId: RunId) =>
  Atom.make((get) =>
    O.flatMap(get(selectedAtom), (id) => A.findFirst(get(eventsAtom(runId)), (event) => event.id === id))
  )
)

export { Filters }
