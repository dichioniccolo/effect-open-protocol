import { Match } from "effect"
import * as Str from "effect/String"
import type { RunSide } from "@wire-trace/store"

/** The time part of an ISO timestamp, to the millisecond. */
export const timeOf = (iso: string): string => Str.substring(11, 23)(iso)

/** The date part of an ISO timestamp. */
export const dateOf = (iso: string): string => Str.substring(0, 10)(iso)

const badge = "inline-block rounded-sm px-1.5 py-0.5 font-sans text-xs whitespace-nowrap"

export const SideBadge = ({ side }: { readonly side: RunSide }) =>
  Match.value(side).pipe(
    Match.when("controller", () => (
      <span className={`${badge} bg-side-controller/10 text-side-controller`}>Controller</span>
    )),
    Match.when("client", () => <span className={`${badge} bg-side-client/10 text-side-client`}>Client</span>),
    Match.exhaustive
  )

/**
 * A dot that pulses while something is live. The label beside it carries the
 * state; the pulse is decoration, so it only runs when motion is welcome.
 */
export const LiveDot = ({ className = "" }: { readonly className?: string }) => (
  <span aria-hidden="true" className={`size-1.5 rounded-full bg-live motion-safe:animate-pulse ${className}`} />
)
