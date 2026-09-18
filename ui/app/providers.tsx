"use client"

import { RegistryProvider } from "@effect/atom-react"
import type { ReactNode } from "react"

/** One atom registry for the whole app, so atoms survive navigation. */
export function Providers({ children }: { readonly children: ReactNode }) {
  return <RegistryProvider>{children}</RegistryProvider>
}
