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
import { WireDirection, WireEventKind } from "../../src/transport/WireTrace.ts"

/**
 * Identity of one recorded CLI run, the row id the store assigned when the run
 * started.
 *
 * **Example** (Reading a run id from a URL segment)
 *
 * ```ts
 * import * as S from "effect/Schema"
 * import { RunId } from "@wire-trace/store"
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
 * import { EventId } from "@wire-trace/store"
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
 * import { RunSide } from "@wire-trace/store"
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
 * What a CLI knows about itself when it starts recording: its side and the
 * launch flags that shape the traffic it will record.
 *
 * **Example** (Describing a client launch)
 *
 * ```ts
 * import { RunStart } from "@wire-trace/store"
 *
 * const start = new RunStart({
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
export class RunStart extends S.Class<RunStart>("RunStart")(
  {
    side: RunSide,
    startedAt: S.String,
    host: S.String,
    port: S.Int,
    seed: S.Int,
    latency: Count,
    jitter: Count
  },
  { description: "The launch settings a run is recorded with" }
) {}

/**
 * A recorded run with what a run list needs: its event count, its newest
 * event's time, and its end time once the CLI has stopped.
 *
 * **Details**
 *
 * `endedAt` stays empty for a run that is still recording, and also for one
 * whose process was killed before it could stamp an end, so a caller telling
 * them apart looks at `lastEventAt` too.
 *
 * **Example** (Finding the runs that are still open)
 *
 * ```ts
 * import * as A from "effect/Array"
 * import * as O from "effect/Option"
 * import type { Run } from "@wire-trace/store"
 *
 * const open = (runs: ReadonlyArray<Run>) => A.filter(runs, (run) => O.isNone(run.endedAt))
 * ```
 *
 * @category models
 * @since 0.0.0
 */
export class Run extends RunStart.extend<Run>("Run")(
  {
    id: RunId,
    endedAt: S.OptionFromNullOr(S.String),
    eventCount: Count,
    lastEventAt: S.OptionFromNullOr(S.String)
  },
  { description: "A recorded CLI run with its event count and activity" }
) {}

/**
 * One traced chunk or frame, ready to be written.
 *
 * The fields after `connection` are a `WireEvent` as the tracer emitted it;
 * `raw` stays escaped, so `unescapeWire` still recovers the bytes.
 *
 * **Example** (Recording a handshake frame)
 *
 * ```ts
 * import * as O from "effect/Option"
 * import { NewEvent, RunId } from "@wire-trace/store"
 *
 * const event = new NewEvent({
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
 * @category models
 * @since 0.0.0
 */
export class NewEvent extends S.Class<NewEvent>("NewEvent")(
  {
    runId: RunId,
    connection: S.Int.check(S.isGreaterThan(0)),
    at: S.String,
    direction: WireDirection,
    kind: WireEventKind,
    bytes: Count,
    mid: S.OptionFromNullOr(S.String),
    raw: S.String
  },
  { description: "A traced wire event tagged with its run and connection" }
) {}

/**
 * A recorded event as it is read back, carrying the row id a reader uses as
 * its next cursor.
 *
 * **Example** (Taking the cursor after a page)
 *
 * ```ts
 * import * as A from "effect/Array"
 * import * as O from "effect/Option"
 * import { EventId, type StoredEvent } from "@wire-trace/store"
 *
 * const cursorAfter = (page: ReadonlyArray<StoredEvent>) =>
 *   O.getOrElse(O.map(A.last(page), (event) => event.id), () => EventId.make(0))
 * ```
 *
 * @category models
 * @since 0.0.0
 */
export class StoredEvent extends NewEvent.extend<StoredEvent>("StoredEvent")(
  {
    id: EventId
  },
  { description: "A recorded wire event with its row id" }
) {}

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
 * import { EventQuery, RunId } from "@wire-trace/store"
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
