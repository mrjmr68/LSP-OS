import type { Metadata } from "next"
import Link from "next/link"

import { SetupNav } from "@/components/setup/setup-nav"

export const metadata: Metadata = {
  title: { default: "Setup", template: "%s · Setup · LSP" },
}

export default function SetupLayout({ children }: LayoutProps<"/setup">) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <Link href="/board" className="min-w-0">
            <p className="font-display text-2xl leading-none font-bold tracking-wide">LSP</p>
            <p className="text-xs text-muted-foreground">Setup</p>
          </Link>
          <SetupNav />
          <Link
            href="/board"
            className="ml-auto flex min-h-11 items-center rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted"
          >
            Back to Board
          </Link>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 py-4">{children}</div>
    </div>
  )
}
