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
import { dateOf, LiveDot, SideBadge, timeOf } from "./ui"

const statusLabel = Match.type<RunStatus>().pipe(
  Match.when("recording", () => (
    <span className="inline-flex items-center gap-1.5 text-live">
      <LiveDot /> Recording
    </span>
  )),
  Match.when("ended", () => <span className="text-fg-muted">Ended</span>),
  Match.when("quiet", () => <span className="text-warning">Stopped without an end time</span>),
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
    <main className="mx-auto w-full max-w-5xl flex-1 overflow-auto px-6 py-8">
      <h1 className="mb-1 text-lg font-medium text-balance">Runs</h1>
      <p className="mb-6 text-sm text-pretty text-fg-secondary">
        One row per <code className="font-mono text-fg">bun run controller</code> or{" "}
        <code className="font-mono text-fg">bun run client</code>, newest first. Times are UTC.
      </p>
      {A.match(runs, {
        onEmpty: () => (
          <div className="rounded-lg px-6 py-12 text-center shadow-ring">
            <p className="text-sm font-medium">No runs recorded yet</p>
            <p className="mt-1 text-sm text-pretty text-fg-secondary">
              Start both commands from the repo root. Their runs appear here as they record.
            </p>
            <pre className="mt-4 inline-block rounded-md bg-raised px-3 py-2 text-start font-mono text-xs text-fg-secondary">
              {"bun run controller -- --result-interval 2000\nbun run client"}
            </pre>
          </div>
        ),
        onNonEmpty: (listed) => (
          <table className="w-full text-start text-sm">
            <thead className="border-b border-line text-xs tracking-wider text-fg-muted uppercase">
              <tr>
                <th className="py-2 pe-4 text-start font-normal">Run</th>
                <th className="py-2 pe-4 text-start font-normal">Side</th>
                <th className="py-2 pe-4 text-start font-normal">Started</th>
                <th className="py-2 pe-4 text-start font-normal">Port</th>
                <th className="py-2 pe-4 text-end font-normal">Events</th>
                <th className="py-2 text-start font-normal">Status</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {A.map(listed, ({ run, status }) => (
                <tr
                  key={run.id}
                  className="relative border-b border-line hover:bg-raised"
                >
                  <td className="py-2 pe-4">
                    {/* The link covers the whole row, so the row is one target. */}
                    <Link
                      href={`/runs/${run.id}`}
                      aria-label={`Run ${run.id}, ${run.side}, ${statusText[status]}`}
                      className="font-medium after:absolute after:inset-0"
                    >
                      #{run.id}
                    </Link>
                  </td>
                  <td className="py-2 pe-4"><SideBadge side={run.side} /></td>
                  <td className="py-2 pe-4 text-fg-secondary tabular-nums">
                    {dateOf(run.startedAt)} {timeOf(run.startedAt)}
                  </td>
                  <td className="py-2 pe-4 text-fg-secondary tabular-nums">{run.port}</td>
                  <td className="py-2 pe-4 text-end tabular-nums">{run.eventCount}</td>
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

const statusText: Record<RunStatus, string> = {
  recording: "recording",
  ended: "ended",
  quiet: "stopped without an end time"
}
