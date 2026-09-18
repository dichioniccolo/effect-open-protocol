import { Match } from "effect"
import * as Str from "effect/String"
import type { RunSide } from "@wire-trace/store"

/** The time part of an ISO timestamp, to the millisecond. */
export const timeOf = (iso: string): string => Str.substring(11, 23)(iso)

/** The date part of an ISO timestamp. */
export const dateOf = (iso: string): string => Str.substring(0, 10)(iso)

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
