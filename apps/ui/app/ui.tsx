import { Badge } from "@/components/ui/badge"
import * as Str from "effect/String"
import type { RunSide } from "@effect-open-protocol/store"

/** The time part of an ISO timestamp, to the millisecond. */
export const timeOf = (iso: string): string => Str.substring(11, 23)(iso)

/** The date part of an ISO timestamp. */
export const dateOf = (iso: string): string => Str.substring(0, 10)(iso)

const sideLabel: Record<RunSide, string> = { controller: "Controller", client: "Client" }

export const SideBadge = ({ side }: { readonly side: RunSide }) => <Badge variant={side}>{sideLabel[side]}</Badge>

/**
 * A dot that pulses while something is live. The label beside it carries the
 * state; the pulse is decoration, so it only runs when motion is welcome.
 */
export const LiveDot = () => (
  <span aria-hidden="true" className="size-1.5 rounded-full bg-live motion-safe:animate-pulse" />
)
