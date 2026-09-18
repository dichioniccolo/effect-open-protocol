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
      <body className="min-h-screen bg-zinc-950 font-sans text-zinc-200 antialiased">
        <header className="border-b border-zinc-800 bg-zinc-950/80 px-6 py-3">
          <Link href="/" className="font-mono text-sm tracking-wide text-zinc-100 hover:text-white">
            <span className="text-emerald-400">▍</span> wire trace
          </Link>
        </header>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
