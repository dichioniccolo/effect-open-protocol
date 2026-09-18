import Link from "next/link"
import type { ReactNode } from "react"
import { Providers } from "./providers"
import "./globals.css"

export const metadata = {
  title: "Wire trace",
  description: "Recorded Open Protocol traffic between the controller and client CLIs"
}

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <body className="flex h-dvh flex-col bg-canvas font-sans text-fg antialiased">
        <header className="shrink-0 border-b border-line px-6 py-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-sm text-sm font-medium text-fg"
          >
            <span aria-hidden="true" className="size-2 rounded-xs bg-live" />
            Wire trace
          </Link>
        </header>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
