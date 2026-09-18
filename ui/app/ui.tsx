import { Match } from "effect"
import type { RunSide } from "@wire-trace/store"

/** The time part of an ISO timestamp, to the millisecond. */
export const timeOf = (iso: string): string => iso.slice(11, 23)

export const SideBadge = ({ side }: { readonly side: RunSide }) =>
  Match.value(side).pipe(
    Match.when("controller", () => (
      <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-xs text-amber-300">controller</span>
    )),
    Match.when("client", () => (
      <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-xs text-sky-300">client</span>
    )),
    Match.exhaustive
  )
