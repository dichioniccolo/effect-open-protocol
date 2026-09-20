/**
 * The shapes of a recorded wire trace: runs, events, and the queries that read
 * them back.
 *
 * They are what the CLIs write and the UI reads, so they live apart from the
 * store that keeps them in SQLite.
 *
 * @since 0.0.0
 */
import { Effect } from "effect"
import * as S from "effect/Schema"
import { Model } from "effect/unstable/schema"
import { WireDirection, WireEventKind } from "effect-open-protocol"

/**
 * Identity of one recorded CLI run, the row id the store assigned when the run
 * started.
 *
 * **Example** (Reading a run id from a URL segment)
 *
 * ```ts
 * import * as S from "effect/Schema"
 * import { RunId } from "@effect-open-protocol/store"
 *
 * const fromUrl = S.decodeUnknownOption(S.FiniteFromString.pipe(S.decodeTo(RunId)))
 *
 * const id = fromUrl("12")
 * ```
 *
 * @category models
 * @since 0.0.0
 */
export const RunId = S.Int.check(S.isGreaterThan(0)).pipe(S.brand("RunId")).annotate({
  identifier: "RunId",
  description: "Row id of one recorded CLI process run"
})

/**
 * @category models
 * @since 0.0.0
 */
export type RunId = typeof RunId.Type

/**
 * Identity of one recorded event, and the cursor a reader pages from: ids only
 * grow, so "after id N" is always "everything newer than what I have".
 *
 * **Example** (Starting a reader at the beginning of a run)
 *
 * ```ts
 * import { EventId } from "@effect-open-protocol/store"
 *
 * const fromTheStart = EventId.make(0)
 * ```
 *
 * @category models
 * @since 0.0.0
 */
export const EventId = S.Int.check(S.isGreaterThanOrEqualTo(0)).pipe(S.brand("EventId")).annotate({
  identifier: "EventId",
  description: "Row id of one recorded wire event; ids only grow, so the last one seen is a cursor"
})

/**
 * @category models
 * @since 0.0.0
 */
export type EventId = typeof EventId.Type

/**
 * Which CLI recorded a run: the simulated controller or the library's client.
 *
 * **Example** (Checking a side read from elsewhere)
 *
 * ```ts
 * import * as S from "effect/Schema"
 * import { RunSide } from "@effect-open-protocol/store"
 *
 * const isSide = S.is(RunSide)
 *
 * console.log(isSide("controller")) // true
 * ```
 *
 * @category models
 * @since 0.0.0
 */
export const RunSide = S.Literals(["controller", "client"]).annotate({
  identifier: "RunSide",
  description: "Which end of the link recorded the run"
})

/**
 * @category models
 * @since 0.0.0
 */
export type RunSide = typeof RunSide.Type

const Count = S.Int.check(S.isGreaterThanOrEqualTo(0))

/**
 * One recorded CLI run: the `runs` row, with the id SQLite assigns on insert.
 *
 * **Details**
 *
 * `Run.insert` is the same row without that id — what a CLI knows about itself
 * when it starts recording. `endedAt` stays `None` for a run that is still
 * recording, and also for one whose process was killed before it could stamp
 * an end, so a caller telling them apart looks at a summary's `lastEventAt`
 * too.
 *
 * **Example** (Describing a client launch)
 *
 * ```ts
 * import { Run } from "@effect-open-protocol/store"
 *
 * const start = Run.insert.make({
 *   side: "client",
 *   startedAt: "2026-09-18T10:00:00.000Z",
 *   host: "127.0.0.1",
 *   port: 4545,
 *   seed: 1,
 *   latency: 40,
 *   jitter: 15
 * })
 * ```
 *
 * @category models
 * @since 0.0.0
 */
export class Run extends Model.Class<Run>("Run")({
  // The database assigns it, so it is absent from `insert`; `update` keeps it
  // because that is how a repository names the row it is updating.
  id: Model.Field({ select: RunId, update: RunId, json: RunId }),
  side: RunSide,
  startedAt: S.String,
  // Never part of an insert: a run's end is stamped later, by `endRun`.
  endedAt: Model.FieldOption(Model.FieldExcept(["insert"])(S.String)),
  host: S.String,
  port: S.Int,
  seed: Count,
  latency: Count,
  jitter: Count
}) {}

/**
 * A recorded run with what a run list needs: the row plus its event count and
 * its newest event's time.
 *
 * **Details**
 *
 * The two extra fields are correlated subselects, not columns of `runs`, so
 * this is the shape the store's run queries decode - `Run` itself stays the
 * table.
 *
 * **Example** (Finding the runs that are still open)
 *
 * ```ts
 * import * as A from "effect/Array"
 * import * as O from "effect/Option"
 * import type { RunSummary } from "@effect-open-protocol/store"
 *
 * const open = (runs: ReadonlyArray<RunSummary>) => A.filter(runs, (run) => O.isNone(run.endedAt))
 * ```
 *
 * @category models
 * @since 0.0.0
 */
export class RunSummary extends Run.extend<RunSummary>("RunSummary")(
  {
    eventCount: Count,
    lastEventAt: S.OptionFromNullOr(S.String)
  },
  { description: "A recorded CLI run with its event count and activity" }
) {}

/**
 * One traced chunk or frame as it is stored: the `events` row, with the id that
 * a reader pages from.
 *
 * **Details**
 *
 * `TracedEvent.insert` is the same event without that id - what a tracer emits,
 * tagged with its run and connection. `raw` stays escaped, so `unescapeWire`
 * still recovers the bytes.
 *
 * **Example** (Recording a handshake frame)
 *
 * ```ts
 * import * as O from "effect/Option"
 * import { RunId, TracedEvent } from "@effect-open-protocol/store"
 *
 * const event = TracedEvent.insert.make({
 *   runId: RunId.make(1),
 *   connection: 1,
 *   at: "2026-09-18T10:00:00.100Z",
 *   direction: "send",
 *   kind: "frame",
 *   bytes: 21,
 *   mid: O.some("0001"),
 *   raw: "00200001001001010000\\0"
 * })
 * ```
 *
 * **Example** (Taking the cursor after a page)
 *
 * ```ts
 * import * as A from "effect/Array"
 * import * as O from "effect/Option"
 * import { EventId, type TracedEvent } from "@effect-open-protocol/store"
 *
 * const cursorAfter = (page: ReadonlyArray<TracedEvent>) =>
 *   O.getOrElse(O.map(A.last(page), (event) => event.id), () => EventId.make(0))
 * ```
 *
 * @category models
 * @since 0.0.0
 */
export class TracedEvent extends Model.Class<TracedEvent>("TracedEvent")({
  id: Model.GeneratedByDb(EventId),
  runId: RunId,
  connection: S.Int.check(S.isGreaterThan(0)),
  at: S.String,
  direction: WireDirection,
  kind: WireEventKind,
  bytes: Count,
  mid: Model.FieldOption(S.String),
  raw: S.String
}) {}

/**
 * Which events of a run to read: a page after a cursor, oldest first,
 * optionally narrowed to one kind, direction or MID.
 *
 * **Details**
 *
 * `after` defaults to 0, the start of the run, and `limit` to 500 events.
 *
 * **Example** (The frames a controller sent, from the start)
 *
 * ```ts
 * import * as O from "effect/Option"
 * import { EventQuery, RunId } from "@effect-open-protocol/store"
 *
 * const query = new EventQuery({
 *   runId: RunId.make(1),
 *   kind: O.some("frame"),
 *   direction: O.some("send"),
 *   mid: O.none()
 * })
 * ```
 *
 * @category models
 * @since 0.0.0
 */
export class EventQuery extends S.Class<EventQuery>("EventQuery")(
  {
    runId: RunId,
    after: EventId.pipe(S.withConstructorDefault(Effect.succeed(EventId.make(0)))),
    limit: S.Int.check(S.isBetween({ minimum: 1, maximum: 5000 })).pipe(S.withConstructorDefault(Effect.succeed(500))),
    kind: S.OptionFromNullOr(WireEventKind),
    direction: S.OptionFromNullOr(WireDirection),
    mid: S.OptionFromNullOr(S.String)
  },
  { description: "A page of one run's events after a cursor, with optional filters" }
) {}
