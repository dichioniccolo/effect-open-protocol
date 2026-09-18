"use client"

import { useAtom, useAtomInitialValues, useAtomSet, useAtomValue } from "@effect/atom-react"
import type { Run, StoredEvent } from "@wire-trace/store"
import { Match } from "effect"
import * as A from "effect/Array"
import * as O from "effect/Option"
import * as S from "effect/Schema"
import { useMemo } from "react"
import {
  eventsAtom,
  Filters,
  filtersAtom,
  midsAtom,
  selectedAtom,
  selectedEventAtom,
  visibleAtom
} from "@/lib/atoms"
import { type DirectionFilter, EventPageJson, headerOf, RunJson } from "@/lib/wire"
import type { Header } from "../../../../src/protocol/Header.ts"
import { SideBadge, timeOf } from "../../ui"

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
    onNone: () => <main className="p-8 text-sm text-red-400">The server sent a run this page cannot read.</main>,
    onSome: (page) => <LoadedRun run={page.run} initial={page.events} />
  })
}

function LoadedRun({ run, initial }: { readonly run: Run; readonly initial: ReadonlyArray<StoredEvent> }) {
  useAtomInitialValues([[eventsAtom(run.id), initial]])
  const all = useAtomValue(eventsAtom(run.id))
  const shown = useAtomValue(visibleAtom(run.id))

  return (
    <main className="flex h-[calc(100vh-49px)] flex-col">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-zinc-800 px-6 py-3 text-sm">
        <div className="flex items-center gap-2">
          <span className="font-mono text-zinc-100">run #{run.id}</span>
          <SideBadge side={run.side} />
        </div>
        <span className="font-mono text-xs text-zinc-500">
          {run.host}:{run.port} · seed {run.seed} · latency {run.latency}±{run.jitter} ms · started{" "}
          {run.startedAt.slice(0, 10)} {timeOf(run.startedAt)} UTC
        </span>
      </div>
      <FilterBar runId={run.id} shown={shown.length} total={all.length} />
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_30rem]">
        <PacketTable runId={run.id} events={shown} />
        <DetailPane runId={run.id} />
      </div>
    </main>
  )
}

const directions: ReadonlyArray<DirectionFilter> = ["all", "send", "recv"]

function FilterBar({ runId, shown, total }: { readonly runId: Run["id"]; readonly shown: number; readonly total: number }) {
  const [filters, setFilters] = useAtom(filtersAtom)
  const mids = useAtomValue(midsAtom(runId))
  const set = (change: Partial<Filters>) => setFilters(new Filters({ ...filters, ...change }))

  return (
    <div className="flex flex-wrap items-center gap-4 border-b border-zinc-800 bg-zinc-900/40 px-6 py-2 text-xs">
      <div className="flex overflow-hidden rounded border border-zinc-700">
        {A.map(directions, (direction) => (
          <button
            key={direction}
            type="button"
            onClick={() => set({ direction })}
            className={`px-2.5 py-1 ${
              filters.direction === direction ? "bg-zinc-700 text-zinc-100" : "text-zinc-400 hover:bg-zinc-800"
            }`}
          >
            {direction}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-zinc-400">
        MID
        <select
          value={O.getOrElse(filters.mid, () => "")}
          onChange={(event) => set({ mid: O.liftPredicate(event.target.value, (value) => value !== "") })}
          className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-1 font-mono text-zinc-200"
        >
          <option value="">any</option>
          {A.map(mids, (mid) => <option key={mid} value={mid}>{mid}</option>)}
        </select>
      </label>
      <label className="flex cursor-pointer items-center gap-2 text-zinc-400">
        <input
          type="checkbox"
          checked={filters.showChunks}
          onChange={(event) => set({ showChunks: event.target.checked })}
          className="accent-emerald-500"
        />
        show socket chunks
      </label>
      <span className="ml-auto font-mono text-zinc-500">
        {shown} of {total} events
      </span>
    </div>
  )
}

const arrow = (event: StoredEvent) =>
  Match.value(event.direction).pipe(
    Match.when("send", () => <span className="text-sky-400">→</span>),
    Match.when("recv", () => <span className="text-amber-400">←</span>),
    Match.exhaustive
  )

function PacketTable({ runId, events }: { readonly runId: Run["id"]; readonly events: ReadonlyArray<StoredEvent> }) {
  const setSelected = useAtomSet(selectedAtom)
  const open = useAtomValue(selectedEventAtom(runId))
  const openId = O.map(open, (event) => event.id)

  return (
    <div className="min-h-0 overflow-auto border-zinc-800 lg:border-r">
      {A.match(events, {
        onEmpty: () => <p className="px-6 py-10 text-sm text-zinc-500">No events match these filters yet.</p>,
        onNonEmpty: (rows) => (
          <table className="w-full table-fixed font-mono text-xs">
            <thead className="sticky top-0 bg-zinc-950 text-left text-[11px] uppercase tracking-wider text-zinc-500">
              <tr className="border-b border-zinc-800">
                <th className="w-32 py-1.5 pr-3 pl-6 font-normal">Time (UTC)</th>
                <th className="w-12 py-1.5 pr-3 font-normal">Conn</th>
                <th className="w-6 py-1.5 pr-3 font-normal" />
                <th className="w-14 py-1.5 pr-3 font-normal">MID</th>
                <th className="w-14 py-1.5 pr-3 text-right font-normal">Bytes</th>
                <th className="py-1.5 pr-6 font-normal">Raw</th>
              </tr>
            </thead>
            <tbody>
              {A.map(rows, (event) => {
                const isOpen = O.contains(openId, event.id)
                return (
                  <tr
                    key={event.id}
                    onClick={() => setSelected(isOpen ? O.none() : O.some(event.id))}
                    aria-selected={isOpen}
                    className={`cursor-pointer border-b border-zinc-900 ${
                      isOpen ? "bg-emerald-500/10" : "hover:bg-zinc-900"
                    } ${event.kind === "chunk" ? "text-zinc-500" : "text-zinc-300"}`}
                  >
                    <td className="py-1 pr-3 pl-6 whitespace-nowrap text-zinc-500">{timeOf(event.at)}</td>
                    <td className="py-1 pr-3 text-zinc-600">{event.connection}</td>
                    <td className="py-1 pr-3">{arrow(event)}</td>
                    <td className="py-1 pr-3">
                      {O.getOrElse(event.mid, () => (event.kind === "chunk" ? "chunk" : "----"))}
                    </td>
                    <td className="py-1 pr-3 text-right tabular-nums text-zinc-500">{event.bytes}</td>
                    <td className="truncate py-1 pr-6 whitespace-pre">{event.raw}</td>
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
  <pre className="font-mono text-xs leading-relaxed break-all whitespace-pre-wrap text-zinc-200">
    {A.map(raw.split(escapes), (part, index) =>
      index % 2 === 1
        ? <span key={index} className="rounded-sm bg-fuchsia-500/15 text-fuchsia-300">{part}</span>
        : <span key={index} className="bg-zinc-800/60">{part}</span>)}
  </pre>
)

const headerRows = (header: Header): ReadonlyArray<readonly [string, string]> => [
  ["length", `${header.length}`],
  ["MID", `${header.mid}`.padStart(4, "0")],
  ["revision", `${header.revision}`],
  ["ack", header.noAck ? "no ack" : "acknowledged"],
  ["station", `${header.stationId}`],
  ["spindle", `${header.spindleId}`]
]

function DetailPane({ runId }: { readonly runId: Run["id"] }) {
  const open = useAtomValue(selectedEventAtom(runId))
  return (
    <aside className="hidden min-h-0 overflow-auto bg-zinc-900/30 px-6 py-5 lg:block">
      {O.match(open, {
        onNone: () => <p className="text-sm text-zinc-500">Select a packet to see its raw bytes and header.</p>,
        onSome: (event) => (
          <div className="space-y-5">
            <div className="flex items-baseline justify-between">
              <h2 className="font-mono text-sm text-zinc-100">
                {event.direction === "send" ? "sent" : "received"} {event.kind}
              </h2>
              <span className="font-mono text-xs text-zinc-500">event #{event.id}</span>
            </div>
            <dl className="grid grid-cols-[6rem_1fr] gap-y-1 font-mono text-xs">
              <dt className="text-zinc-500">at</dt>
              <dd>{event.at}</dd>
              <dt className="text-zinc-500">connection</dt>
              <dd>{event.connection}</dd>
              <dt className="text-zinc-500">bytes</dt>
              <dd>{event.bytes}</dd>
            </dl>
            <section>
              <h3 className="mb-2 text-xs uppercase tracking-wider text-zinc-500">Raw, escaped</h3>
              <Raw raw={event.raw} />
            </section>
            <section>
              <h3 className="mb-2 text-xs uppercase tracking-wider text-zinc-500">Header</h3>
              {O.match(headerOf(event), {
                onNone: () => (
                  <p className="text-xs text-zinc-500">
                    {event.kind === "chunk"
                      ? "A socket chunk has no header of its own; show frames to read one."
                      : "This frame's header does not decode."}
                  </p>
                ),
                onSome: (header) => (
                  <dl className="grid grid-cols-[6rem_1fr] gap-y-1 font-mono text-xs">
                    {A.flatMap(headerRows(header), ([label, value]) => [
                      <dt key={`${label}-t`} className="text-zinc-500">{label}</dt>,
                      <dd key={`${label}-d`} className="text-zinc-200">{value}</dd>
                    ])}
                  </dl>
                )
              })}
            </section>
          </div>
        )
      })}
    </aside>
  )
}
