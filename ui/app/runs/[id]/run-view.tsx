"use client"

import { useAtom, useAtomInitialValues, useAtomSet, useAtomValue } from "@effect/atom-react"
import type { Run, StoredEvent } from "@wire-trace/store"
import { Match } from "effect"
import * as A from "effect/Array"
import * as Num from "effect/Number"
import * as O from "effect/Option"
import * as S from "effect/Schema"
import * as Str from "effect/String"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { type KeyboardEvent, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  eventsAtom,
  Filters,
  filtersAtom,
  liveAtom,
  type LiveStatus,
  midsAtom,
  selectedAtom,
  selectedEventAtom,
  visibleAtom
} from "@/lib/atoms"
import { cn } from "@/lib/utils"
import { DirectionFilter, EventPageJson, headerOf, noFilters, RunJson } from "@/lib/wire"
import type { Header } from "../../../../src/protocol/Header.ts"
import { dateOf, LiveDot, SideBadge, timeOf } from "../../ui"

export function RunView({ run, events }: { readonly run: string; readonly events: string }) {
  const decoded = useMemo(
    () =>
      O.all({
        run: S.decodeOption(RunJson)(run),
        events: S.decodeOption(EventPageJson)(events)
      }),
    [run, events]
  )

  return O.match(decoded, {
    onNone: () => (
      <main className="flex-1 p-8 text-sm text-destructive">
        Unable to read this run. Reload the page to try again.
      </main>
    ),
    onSome: (page) => <LoadedRun run={page.run} initial={page.events} />
  })
}

function LoadedRun({ run, initial }: { readonly run: Run; readonly initial: ReadonlyArray<StoredEvent> }) {
  useAtomInitialValues([[eventsAtom(run.id), initial]])
  const all = useAtomValue(eventsAtom(run.id))
  const shown = useAtomValue(visibleAtom(run.id))
  const live = useAtomValue(liveAtom(run.id))

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b px-6 py-3">
        <div className="flex items-center gap-2">
          <h1 className="font-mono text-sm font-medium">Run #{run.id}</h1>
          <SideBadge side={run.side} />
          <LiveBadge live={live} ended={O.isSome(run.endedAt)} />
        </div>
        <p className="font-mono text-xs text-muted-foreground tabular-nums">
          {run.host}:{run.port} · seed {run.seed} · latency {run.latency}±{run.jitter}&nbsp;ms · started{" "}
          {dateOf(run.startedAt)} {timeOf(run.startedAt)} UTC
        </p>
      </div>
      <FilterBar runId={run.id} shown={shown.length} total={all.length} />
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(0,45%)] lg:grid-cols-[minmax(0,1fr)_30rem] lg:grid-rows-1">
        <PacketTable runId={run.id} events={shown} total={all.length} />
        <DetailPane runId={run.id} />
      </div>
    </main>
  )
}

/** Whether new events are still arriving. The label carries the state; the dot only decorates it. */
function LiveBadge({
  live,
  ended
}: {
  readonly live: AsyncResult.AsyncResult<LiveStatus, unknown>
  readonly ended: boolean
}) {
  return ended ? (
    <span className="text-xs text-muted-foreground">Ended</span>
  ) : (
    AsyncResult.match(live, {
      onInitial: () => <span className="text-xs text-muted-foreground">Connecting…</span>,
      onSuccess: ({ value }) =>
        value === "live" ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-live">
            <LiveDot /> Live
          </span>
        ) : (
          <span className="text-xs text-warning">Reconnecting…</span>
        ),
      onFailure: () => <span className="text-xs text-destructive">Live updates stopped. Reload to reconnect.</span>
    })
  )
}

const directions: ReadonlyArray<readonly [DirectionFilter, string]> = [
  ["all", "All"],
  ["send", "Sent"],
  ["recv", "Received"]
]

const decodeDirection = S.decodeUnknownOption(DirectionFilter)

/** One MID filter choice; `null` is "any MID". */
interface MidItem {
  readonly label: string
  readonly value: string | null
}

function FilterBar({
  runId,
  shown,
  total
}: {
  readonly runId: Run["id"]
  readonly shown: number
  readonly total: number
}) {
  const [filters, setFilters] = useAtom(filtersAtom)
  const mids = useAtomValue(midsAtom(runId))
  const set = (change: Partial<Filters>) => setFilters(new Filters({ ...filters, ...change }))

  const midItems = A.prepend(
    A.map(mids, (mid): MidItem => ({ label: mid, value: mid })),
    { label: "Any", value: null } satisfies MidItem
  )

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b bg-card/40 px-6 py-2">
      <ToggleGroup
        aria-label="Direction"
        variant="outline"
        size="sm"
        spacing={0}
        value={[filters.direction]}
        // Pressing the active item empties the group; a direction is always chosen, so keep it.
        onValueChange={(value) => O.map(O.flatMap(A.head(value), decodeDirection), (direction) => set({ direction }))}
      >
        {A.map(directions, ([direction, label]) => (
          <ToggleGroupItem key={direction} value={direction}>
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Field orientation="horizontal" className="w-auto">
        <FieldLabel htmlFor="mid-filter">MID</FieldLabel>
        <Select
          items={midItems}
          value={O.getOrNull(filters.mid)}
          onValueChange={(value) => set({ mid: O.fromNullishOr(value) })}
        >
          <SelectTrigger id="mid-filter" size="sm" className="min-w-24 font-mono">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {A.map(midItems, (item) => (
                <SelectItem key={item.label} value={item.value} className="font-mono">
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <Field orientation="horizontal" className="w-auto">
        <Checkbox
          id="show-chunks"
          checked={filters.showChunks}
          onCheckedChange={(checked) => set({ showChunks: checked })}
        />
        <FieldLabel htmlFor="show-chunks">Show socket chunks</FieldLabel>
      </Field>
      <span className="ms-auto font-mono text-xs text-muted-foreground tabular-nums">
        {shown} of {total} events
      </span>
    </div>
  )
}

const arrow = (event: StoredEvent) =>
  Match.value(event.direction).pipe(
    Match.when("send", () => <span title="Sent">→</span>),
    Match.when("recv", () => <span title="Received">←</span>),
    Match.exhaustive
  )

/** Moves focus between packet rows with the arrow keys, so the table is usable without a mouse. */
const moveWithArrows = (event: KeyboardEvent<HTMLTableSectionElement>) => {
  const step = Match.value(event.key).pipe(
    Match.when("ArrowDown", () => 1),
    Match.when("ArrowUp", () => -1),
    Match.orElse(() => 0)
  )

  if (step === 0) return
  const rows = A.fromIterable(event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-row]"))

  const at = O.getOrElse(
    A.findFirstIndex(rows, (row) => row === document.activeElement),
    () => -1
  )

  O.map(A.get(rows, Num.clamp(at + step, { minimum: 0, maximum: rows.length - 1 })), (next) => {
    event.preventDefault()
    next.focus()
    next.click()
  })
}

function PacketTable({
  runId,
  events,
  total
}: {
  readonly runId: Run["id"]
  readonly events: ReadonlyArray<StoredEvent>
  readonly total: number
}) {
  const setSelected = useAtomSet(selectedAtom)
  const setFilters = useAtomSet(filtersAtom)
  const open = useAtomValue(selectedEventAtom(runId))
  const openId = O.map(open, (event) => event.id)

  return (
    // The table's own container becomes the scroller, so the header can stick.
    <div className="min-h-0 overflow-hidden lg:border-e [&>[data-slot=table-container]]:h-full [&>[data-slot=table-container]]:overflow-auto">
      {A.match(events, {
        onEmpty: () =>
          total === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No events recorded yet</EmptyTitle>
                <EmptyDescription>Events appear here as soon as this run exchanges a frame.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No events match these filters</EmptyTitle>
                <EmptyDescription>
                  {total} events in this run are hidden by the direction, MID or chunk filters.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="outline" size="sm" onClick={() => setFilters(noFilters)}>
                  Clear filters
                </Button>
              </EmptyContent>
            </Empty>
          ),
        onNonEmpty: (rows) => (
          <Table className="table-fixed font-mono text-xs">
            {/* Rows are positioned (for the stretched row button), so the header needs its own layer to stay on top. */}
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead className="w-32 ps-6">Time (UTC)</TableHead>
                <TableHead className="w-12">Conn</TableHead>
                <TableHead className="w-8">
                  <span className="sr-only">Direction</span>
                </TableHead>
                <TableHead className="w-14">MID</TableHead>
                <TableHead className="w-16 text-end">Bytes</TableHead>
                <TableHead className="pe-6">Raw</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody onKeyDown={moveWithArrows}>
              {A.map(rows, (event) => {
                const isOpen = O.contains(openId, event.id)
                const quiet = isOpen ? "text-subtle-foreground" : "text-muted-foreground"

                return (
                  <TableRow
                    key={event.id}
                    data-state={isOpen ? "selected" : undefined}
                    className={cn("relative", event.kind === "chunk" && quiet)}
                  >
                    <TableCell className={cn("py-1 ps-6 tabular-nums", quiet)}>
                      {/* One button per row, stretched over the row, so the row is a real control. */}
                      <button
                        type="button"
                        data-row
                        aria-current={isOpen ? "true" : undefined}
                        aria-label={`${event.direction === "send" ? "Sent" : "Received"} ${event.kind} ${O.getOrElse(
                          event.mid,
                          () => ""
                        )} at ${timeOf(event.at)}`}
                        onClick={() => setSelected(isOpen ? O.none() : O.some(event.id))}
                        className="text-start outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
                      >
                        {timeOf(event.at)}
                      </button>
                    </TableCell>
                    <TableCell className={cn("py-1 tabular-nums", quiet)}>{event.connection}</TableCell>
                    <TableCell className={cn("py-1", quiet)}>{arrow(event)}</TableCell>
                    <TableCell className="py-1">
                      {O.getOrElse(event.mid, () => (event.kind === "chunk" ? "chunk" : "----"))}
                    </TableCell>
                    <TableCell className={cn("py-1 text-end tabular-nums", quiet)}>{event.bytes}</TableCell>
                    <TableCell className="truncate py-1 pe-6 whitespace-pre">{event.raw}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )
      })}
    </div>
  )
}

/** Splits an escaped wire string so escape sequences can be told apart from text. */
const escapes = /(\\x[0-9a-f]{2}|\\[0tnr\\])/g

const Raw = ({ raw }: { readonly raw: string }) => (
  <pre className="rounded-md border bg-background p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">
    {A.map(Str.split(raw, escapes), (part, index) =>
      index % 2 === 1 ? (
        <span key={index} className="text-escape">
          {part}
        </span>
      ) : (
        <span key={index}>{part}</span>
      )
    )}
  </pre>
)

const headerRows = (header: Header): ReadonlyArray<readonly [string, string]> => [
  ["Length", `${header.length}`],
  ["MID", Str.padStart(4, "0")(`${header.mid}`)],
  ["Revision", `${header.revision}`],
  ["Acknowledgement", header.noAck ? "Not requested" : "Requested"],
  ["Station", `${header.stationId}`],
  ["Spindle", `${header.spindleId}`]
]

const Fields = ({ rows }: { readonly rows: ReadonlyArray<readonly [string, string]> }) => (
  <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-xs">
    {A.flatMap(rows, ([label, value]) => [
      <dt key={`${label}-t`} className="text-muted-foreground">
        {label}
      </dt>,
      <dd key={`${label}-d`} className="font-mono tabular-nums">
        {value}
      </dd>
    ])}
  </dl>
)

const SectionTitle = ({ children }: { readonly children: string }) => (
  <h3 className="text-xs font-medium text-muted-foreground">{children}</h3>
)

function DetailPane({ runId }: { readonly runId: Run["id"] }) {
  const open = useAtomValue(selectedEventAtom(runId))

  return (
    <aside aria-label="Event detail" className="min-h-0 overflow-auto border-t bg-card/40 px-6 py-5 lg:border-t-0">
      {O.match(open, {
        onNone: () => (
          <p className="text-sm text-pretty text-subtle-foreground">
            Select an event to see its raw bytes and decoded header.
          </p>
        ),
        onSome: (event) => (
          <div className="flex flex-col gap-6">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-sm font-medium">
                {event.direction === "send" ? "Sent" : "Received"} {event.kind}
              </h2>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">Event #{event.id}</span>
            </div>
            <Fields
              rows={[
                ["Time", event.at],
                ["Connection", `${event.connection}`],
                ["Size", `${event.bytes} bytes`]
              ]}
            />
            <section className="flex flex-col gap-2">
              <SectionTitle>Raw, escaped</SectionTitle>
              <Raw raw={event.raw} />
            </section>
            <section className="flex flex-col gap-2">
              <SectionTitle>Header</SectionTitle>
              {O.match(headerOf(event), {
                onNone: () => (
                  <p className="text-xs text-pretty text-subtle-foreground">
                    {event.kind === "chunk"
                      ? "A socket chunk has no header of its own. Turn off socket chunks and select a frame to read one."
                      : "This frame's header does not decode."}
                  </p>
                ),
                onSome: (header) => <Fields rows={headerRows(header)} />
              })}
            </section>
          </div>
        )
      })}
    </aside>
  )
}
