import { Geist, Geist_Mono } from "next/font/google"
import Link from "next/link"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { Providers } from "./providers"
import "./globals.css"

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" })

const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" })

export const metadata = {
  title: "Wire trace",
  description: "Recorded Open Protocol traffic between the controller and client CLIs"
}

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en" className={cn("dark font-sans", geist.variable, geistMono.variable)}>
      <body className="flex h-dvh flex-col antialiased">
        <header className="shrink-0 border-b px-6 py-3">
          <Link href="/" className="inline-flex items-center gap-2 rounded-sm text-sm font-medium">
            <span aria-hidden="true" className="size-2 rounded-xs bg-live" />
            Wire trace
          </Link>
        </header>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
