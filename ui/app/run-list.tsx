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
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { type ListedRun, listRuns, type RunStatus, runsAtom } from "@/lib/atoms"
import { RunListJson } from "@/lib/wire"
import { dateOf, LiveDot, SideBadge, timeOf } from "./ui"

const statusLabel = Match.type<RunStatus>().pipe(
  Match.when("recording", () => (
    <span className="inline-flex items-center gap-1.5 text-live">
      <LiveDot /> Recording
    </span>
  )),
  Match.when("ended", () => <span className="text-muted-foreground">Ended</span>),
  Match.when("quiet", () => <span className="text-warning">Stopped without an end time</span>),
  Match.exhaustive
)

const statusText: Record<RunStatus, string> = {
  recording: "recording",
  ended: "ended",
  quiet: "stopped without an end time"
}

export function RunList({ initial, renderedAt }: { readonly initial: string; readonly renderedAt: string }) {
  const rendered = useMemo(
    () =>
      O.getOrElse(
        O.map(S.decodeOption(RunListJson)(initial), (runs) => listRuns(runs, DateTime.makeUnsafe(renderedAt))),
        (): ReadonlyArray<ListedRun> => []
      ),
    [initial, renderedAt]
  )

  const runs = AsyncResult.getOrElse(useAtomValue(runsAtom), () => rendered)

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 overflow-auto px-6 py-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-medium text-balance">Runs</h1>
        <p className="text-sm text-pretty text-subtle-foreground">
          One row per <code className="font-mono text-foreground">bun run controller</code> or{" "}
          <code className="font-mono text-foreground">bun run client</code>, newest first. Times are UTC.
        </p>
      </div>
      {A.match(runs, {
        onEmpty: () => (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>No runs recorded yet</EmptyTitle>
              <EmptyDescription>
                Start both commands from the repo root. Their runs appear here as they record.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <pre className="rounded-md bg-card px-3 py-2 text-start font-mono text-xs text-subtle-foreground">
                {"bun run controller -- --result-interval 2000\nbun run client"}
              </pre>
            </EmptyContent>
          </Empty>
        ),
        onNonEmpty: (listed) => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="ps-0">Run</TableHead>
                <TableHead>Side</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Port</TableHead>
                <TableHead className="text-end">Events</TableHead>
                <TableHead className="pe-0">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="font-mono">
              {A.map(listed, ({ run, status }) => (
                <TableRow key={run.id} className="relative">
                  <TableCell className="ps-0">
                    {/* The link covers the whole row, so the row is one target. */}
                    <Link
                      href={`/runs/${run.id}`}
                      aria-label={`Run ${run.id}, ${run.side}, ${statusText[status]}`}
                      className="font-medium after:absolute after:inset-0"
                    >
                      #{run.id}
                    </Link>
                  </TableCell>
                  <TableCell className="font-sans">
                    <SideBadge side={run.side} />
                  </TableCell>
                  <TableCell className="text-subtle-foreground tabular-nums">
                    {dateOf(run.startedAt)} {timeOf(run.startedAt)}
                  </TableCell>
                  <TableCell className="text-subtle-foreground tabular-nums">{run.port}</TableCell>
                  <TableCell className="text-end tabular-nums">{run.eventCount}</TableCell>
                  <TableCell className="pe-0 font-sans text-xs">{statusLabel(status)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )
      })}
    </main>
  )
}
