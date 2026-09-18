"use client"

import { useAtom, useAtomInitialValues, useAtomSet, useAtomValue } from "@effect/atom-react"
import type { Run, StoredEvent } from "@wire-trace/store"
import { Match } from "effect"
import * as A from "effect/Array"
import * as Num from "effect/Number"
import * as O from "effect/Option"
import * as S from "effect/Schema"
import * as Str from "effect/String"
import { type KeyboardEvent, useMemo } from "react"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import {
  eventsAtom,
  Filters,
  filtersAtom,
  liveAtom,
  midsAtom,
  selectedAtom,
  selectedEventAtom,
  visibleAtom
} from "@/lib/atoms"
import { type DirectionFilter, EventPageJson, headerOf, noFilters, RunJson } from "@/lib/wire"
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
      <main className="flex-1 p-8 text-sm text-danger">Unable to read this run. Reload the page to try again.</main>
    ),
    onSome: (page) => <LoadedRun run={page.run} initial={page.events} />
  })
}

/** Pressable controls get the same small, interruptible press. */
const press = "transition-[scale] duration-150 ease-out motion-safe:active:scale-[0.96]"

function LoadedRun({ run, initial }: { readonly run: Run; readonly initial: ReadonlyArray<StoredEvent> }) {
  useAtomInitialValues([[eventsAtom(run.id), initial]])
  const all = useAtomValue(eventsAtom(run.id))
  const shown = useAtomValue(visibleAtom(run.id))
  const live = useAtomValue(liveAtom(run.id))

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-line px-6 py-3">
        <div className="flex items-center gap-2">
          <h1 className="font-mono text-sm font-medium">Run #{run.id}</h1>
          <SideBadge side={run.side} />
          <LiveBadge live={live} ended={O.isSome(run.endedAt)} />
        </div>
        <p className="font-mono text-xs text-fg-muted tabular-nums">
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
function LiveBadge({ live, ended }: { readonly live: AsyncResult.AsyncResult<number, unknown>; readonly ended: boolean }) {
  return ended
    ? <span className="text-xs text-fg-muted">Ended</span>
    : AsyncResult.match(live, {
      onInitial: () => <span className="text-xs text-fg-muted">Connecting…</span>,
      onSuccess: () => (
        <span className="inline-flex items-center gap-1.5 text-xs text-live">
          <LiveDot /> Live
        </span>
      ),
      onFailure: () => <span className="text-xs text-danger">Live updates stopped. Reload to reconnect.</span>
    })
}

const directions: ReadonlyArray<readonly [DirectionFilter, string]> = [
  ["all", "All"],
  ["send", "Sent"],
  ["recv", "Received"]
]

function FilterBar({ runId, shown, total }: { readonly runId: Run["id"]; readonly shown: number; readonly total: number }) {
  const [filters, setFilters] = useAtom(filtersAtom)
  const mids = useAtomValue(midsAtom(runId))
  const set = (change: Partial<Filters>) => setFilters(new Filters({ ...filters, ...change }))

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line bg-raised/40 px-6 py-2 text-xs">
      {/* 6px outer radius = 4px inner radius + 2px padding. */}
      <div role="group" aria-label="Direction" className="flex gap-0.5 rounded-md p-0.5 shadow-ring">
        {A.map(directions, ([direction, label]) => {
          const active = filters.direction === direction
          return (
            <button
              key={direction}
              type="button"
              aria-pressed={active}
              onClick={() => set({ direction })}
              className={`rounded-sm px-2.5 py-1 ${press} ${
                active ? "bg-selected text-fg" : "text-fg-secondary hover:text-fg"
              }`}
            >
              {label}
            </button>
          )
        })}
      </div>
      <label className="flex items-center gap-2 text-fg-secondary">
        MID
        <select
          value={O.getOrElse(filters.mid, () => "")}
          onChange={(event) => set({ mid: O.liftPredicate(event.target.value, (value) => value !== "") })}
          className="rounded-md border border-line bg-canvas px-1.5 py-1 font-mono text-base text-fg sm:text-xs"
        >
          <option value="">Any</option>
          {A.map(mids, (mid) => <option key={mid} value={mid}>{mid}</option>)}
        </select>
      </label>
      <label className="flex cursor-pointer items-center gap-2 py-1 text-fg-secondary">
        <input
          type="checkbox"
          checked={filters.showChunks}
          onChange={(event) => set({ showChunks: event.target.checked })}
          className="accent-live"
        />
        Show socket chunks
      </label>
      <span className="ms-auto font-mono text-fg-muted tabular-nums">
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
  const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0
  if (step === 0) return
  const rows = A.fromIterable(event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-row]"))
  const at = O.getOrElse(A.findFirstIndex(rows, (row) => row === document.activeElement), () => -1)
  O.map(A.get(rows, Num.clamp(at + step, { minimum: 0, maximum: rows.length - 1 })), (next) => {
    event.preventDefault()
    next.focus()
    next.click()
  })
}

function PacketTable(
  { runId, events, total }: {
    readonly runId: Run["id"]
    readonly events: ReadonlyArray<StoredEvent>
    readonly total: number
  }
) {
  const setSelected = useAtomSet(selectedAtom)
  const setFilters = useAtomSet(filtersAtom)
  const open = useAtomValue(selectedEventAtom(runId))
  const openId = O.map(open, (event) => event.id)

  return (
    <div className="min-h-0 overflow-auto border-line lg:border-e">
      {A.match(events, {
        onEmpty: () =>
          total === 0
            ? (
              <div className="px-6 py-10 text-sm">
                <p className="font-medium">No events recorded yet</p>
                <p className="mt-1 text-fg-secondary">Events appear here as soon as this run exchanges a frame.</p>
              </div>
            )
            : (
              <div className="px-6 py-10 text-sm">
                <p className="font-medium">No events match these filters</p>
                <button
                  type="button"
                  onClick={() => setFilters(noFilters)}
                  className={`mt-3 rounded-md px-2.5 py-1 text-xs text-fg shadow-ring hover:shadow-ring-hover ${press}`}
                >
                  Clear filters
                </button>
              </div>
            ),
        onNonEmpty: (rows) => (
          <table className="w-full table-fixed font-mono text-xs">
            <thead className="sticky top-0 z-10 bg-canvas text-start text-xs tracking-wider text-fg-muted uppercase">
              <tr className="border-b border-line">
                <th className="w-32 py-1.5 ps-6 pe-3 text-start font-normal">Time (UTC)</th>
                <th className="w-12 py-1.5 pe-3 text-start font-normal">Conn</th>
                <th className="w-6 py-1.5 pe-3 font-normal"><span className="sr-only">Direction</span></th>
                <th className="w-14 py-1.5 pe-3 text-start font-normal">MID</th>
                <th className="w-16 py-1.5 pe-3 text-end font-normal">Bytes</th>
                <th className="py-1.5 pe-6 text-start font-normal">Raw</th>
              </tr>
            </thead>
            <tbody onKeyDown={moveWithArrows}>
              {A.map(rows, (event) => {
                const isOpen = O.contains(openId, event.id)
                const muted = isOpen ? "text-fg-secondary" : "text-fg-muted"
                return (
                  <tr
                    key={event.id}
                    className={`relative border-b border-line ${isOpen ? "bg-selected" : "hover:bg-raised"} ${
                      event.kind === "chunk" ? muted : "text-fg"
                    }`}
                  >
                    <td className={`py-1 ps-6 pe-3 whitespace-nowrap tabular-nums ${muted}`}>
                      {/* One button per row, stretched over the row, so the row is a real control. */}
                      <button
                        type="button"
                        data-row
                        aria-current={isOpen ? "true" : undefined}
                        aria-label={`${event.direction === "send" ? "Sent" : "Received"} ${event.kind} ${
                          O.getOrElse(event.mid, () => "")
                        } at ${timeOf(event.at)}`}
                        onClick={() => setSelected(isOpen ? O.none() : O.some(event.id))}
                        className="text-start after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus"
                      >
                        {timeOf(event.at)}
                      </button>
                    </td>
                    <td className={`py-1 pe-3 tabular-nums ${muted}`}>{event.connection}</td>
                    <td className={`py-1 pe-3 ${muted}`}>{arrow(event)}</td>
                    <td className="py-1 pe-3">
                      {O.getOrElse(event.mid, () => (event.kind === "chunk" ? "chunk" : "----"))}
                    </td>
                    <td className={`py-1 pe-3 text-end tabular-nums ${muted}`}>{event.bytes}</td>
                    <td className="truncate py-1 pe-6 whitespace-pre">{event.raw}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )
      })}
    </div>
  )
}

/** Splits an escaped wire string so escape sequences can be told apart from text. */
const escapes = /(\\x[0-9a-f]{2}|\\[0tnr\\])/g

const Raw = ({ raw }: { readonly raw: string }) => (
  <pre className="rounded-md bg-canvas p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap shadow-ring">
    {A.map(Str.split(raw, escapes), (part, index) =>
      index % 2 === 1
        ? <span key={index} className="text-escape">{part}</span>
        : <span key={index}>{part}</span>)}
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
      <dt key={`${label}-t`} className="text-fg-muted">{label}</dt>,
      <dd key={`${label}-d`} className="font-mono tabular-nums">{value}</dd>
    ])}
  </dl>
)

function DetailPane({ runId }: { readonly runId: Run["id"] }) {
  const open = useAtomValue(selectedEventAtom(runId))
  return (
    <aside
      aria-label="Event detail"
      className="min-h-0 overflow-auto border-t border-line bg-raised/40 px-6 py-5 lg:border-t-0"
    >
      {O.match(open, {
        onNone: () => (
          <p className="text-sm text-pretty text-fg-secondary">
            Select an event to see its raw bytes and decoded header.
          </p>
        ),
        onSome: (event) => (
          <div className="space-y-6">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-sm font-medium">
                {event.direction === "send" ? "Sent" : "Received"} {event.kind}
              </h2>
              <span className="font-mono text-xs text-fg-muted tabular-nums">Event #{event.id}</span>
            </div>
            <Fields
              rows={[
                ["Time", event.at],
                ["Connection", `${event.connection}`],
                ["Size", `${event.bytes} bytes`]
              ]}
            />
            <section>
              <h3 className="mb-2 text-xs tracking-wider text-fg-muted uppercase">Raw, escaped</h3>
              <Raw raw={event.raw} />
            </section>
            <section>
              <h3 className="mb-2 text-xs tracking-wider text-fg-muted uppercase">Header</h3>
              {O.match(headerOf(event), {
                onNone: () => (
                  <p className="text-xs text-pretty text-fg-secondary">
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
