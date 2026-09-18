import type { ReactNode } from "react"
import "./globals.css"

export const metadata = {
  title: "Wire trace",
  description: "Recorded Open Protocol traffic between the controller and client CLIs"
}

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-zinc-950 text-zinc-100 antialiased">{children}</body>
    </html>
  )
}
