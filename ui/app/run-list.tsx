"use client"

import { useAtomValue } from "@effect/atom-react"
import { Match } from "effect"
import * as A from "effect/Array"
import * as DateTime from "effect/DateTime"
import * as O from "effect/Option"
import * as S from "effect/Schema"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import Link from "next/link"
import { useMemo } from "react"
import { type ListedRun, listRuns, type RunStatus, runsAtom } from "@/lib/atoms"
import { RunListJson } from "@/lib/wire"
import { dateOf, SideBadge, timeOf } from "./ui"

const statusLabel = Match.type<RunStatus>().pipe(
  Match.when("recording", () => (
    <span className="inline-flex items-center gap-1.5 text-emerald-400">
      <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" /> recording
    </span>
  )),
  Match.when("ended", () => <span className="text-zinc-500">ended</span>),
  Match.when("quiet", () => <span className="text-amber-500/80">no end stamp</span>),
  Match.exhaustive
)

export function RunList({ initial, renderedAt }: { readonly initial: string; readonly renderedAt: string }) {
  const rendered = useMemo(
    () =>
      O.getOrElse(
        O.map(S.decodeOption(RunListJson)(initial), (runs) =>
          listRuns(runs, DateTime.makeUnsafe(renderedAt))),
        (): ReadonlyArray<ListedRun> => []
      ),
    [initial, renderedAt]
  )
  const runs = AsyncResult.getOrElse(useAtomValue(runsAtom), () => rendered)

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="mb-1 text-lg font-medium text-zinc-100">Runs</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Every <code className="text-zinc-400">bun run controller</code> and{" "}
        <code className="text-zinc-400">bun run client</code> launch, newest first. Times are UTC.
      </p>
      {A.match(runs, {
        onEmpty: () => (
          <div className="rounded-lg border border-dashed border-zinc-800 px-6 py-12 text-center text-sm text-zinc-500">
            Nothing recorded yet. Start the controller and the client from the repo root and runs appear here.
          </div>
        ),
        onNonEmpty: (listed) => (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-800 text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="py-2 pr-4 font-normal">Run</th>
                <th className="py-2 pr-4 font-normal">Side</th>
                <th className="py-2 pr-4 font-normal">Started</th>
                <th className="py-2 pr-4 font-normal">Port</th>
                <th className="py-2 pr-4 text-right font-normal">Events</th>
                <th className="py-2 font-normal">Status</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {A.map(listed, ({ run, status }) => (
                <tr key={run.id} className="group border-b border-zinc-900 hover:bg-zinc-900/60">
                  <td className="py-2 pr-4">
                    <Link href={`/runs/${run.id}`} className="text-zinc-100 group-hover:text-white">
                      #{run.id}
                    </Link>
                  </td>
                  <td className="py-2 pr-4"><SideBadge side={run.side} /></td>
                  <td className="py-2 pr-4 text-zinc-400">
                    {dateOf(run.startedAt)} {timeOf(run.startedAt)}
                  </td>
                  <td className="py-2 pr-4 text-zinc-400">{run.port}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{run.eventCount}</td>
                  <td className="py-2 font-sans text-xs">{statusLabel(status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      })}
    </main>
  )
}
