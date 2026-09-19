/**
 * What the server and the browser agree on: the JSON shapes that cross the
 * wire between them, the packet filters, and how a recorded frame is read.
 *
 * Nothing here touches the database, so both sides can import it.
 */
import * as A from "effect/Array"
import * as O from "effect/Option"
import * as Result from "effect/Result"
import * as S from "effect/Schema"
import * as Str from "effect/String"
import { Run, RunId, StoredEvent } from "@effect-open-protocol/store"
import { decodeHeader, type Header, unescapeWire, WireDirection } from "effect-open-protocol"

/** Every recorded run, as the run list receives it. */
export const RunList = S.Array(Run)

/** A page of one run's events, oldest first. */
export const EventPage = S.Array(StoredEvent)

/** The JSON text of a run list. */
export const RunListJson = S.fromJsonString(S.toCodecJson(RunList))

/** The JSON text of a page of events. */
export const EventPageJson = S.fromJsonString(S.toCodecJson(EventPage))

/** Which way of the link a packet list shows. */
export const DirectionFilter = S.Literals(["all", ...WireDirection.literals]).annotate({
  identifier: "DirectionFilter",
  description: "Both directions, or only what this side sent or received"
})

export type DirectionFilter = typeof DirectionFilter.Type

/** How a run's packet list is narrowed. */
export class Filters extends S.Class<Filters>("Filters")(
  {
    showChunks: S.Boolean,
    direction: DirectionFilter,
    mid: S.Option(S.String)
  },
  { description: "Packet list filters: chunks, direction and MID" }
) {}

export const noFilters = new Filters({ showChunks: false, direction: "all", mid: O.none() })

/** The events a run's packet list shows under the given filters. */
export const visible = (events: ReadonlyArray<StoredEvent>, filters: Filters): ReadonlyArray<StoredEvent> =>
  A.filter(
    events,
    (event) =>
      (filters.showChunks || event.kind === "frame") &&
      (filters.direction === "all" || event.direction === filters.direction) &&
      O.getOrElse(
        O.map(filters.mid, (mid) => O.contains(event.mid, mid)),
        () => true
      )
  )

/** Every MID that appears in a run, sorted, for the MID filter. */
export const midsOf = (events: ReadonlyArray<StoredEvent>): ReadonlyArray<string> =>
  A.sort(A.dedupe(A.getSomes(A.map(events, (event) => event.mid))), Str.Order)

const latin1 = new TextDecoder("latin1")

/**
 * The decoded header of a recorded frame, or none for a chunk or a frame
 * whose header does not parse.
 */
export const headerOf = (event: StoredEvent): O.Option<Header> =>
  event.kind === "frame" ? Result.getSuccess(decodeHeader(latin1.decode(unescapeWire(event.raw)))) : O.none()

/** A run id as it appears in a URL. */
export const RunIdFromString = S.FiniteFromString.pipe(S.decodeTo(RunId))

/** The JSON text of one run. */
export const RunJson = S.fromJsonString(S.toCodecJson(Run))
