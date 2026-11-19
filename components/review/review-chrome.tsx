import Link from "next/link"

/** Desktop: the same dark bar as the Board, with Review lit. */
export function ReviewTopBar({ count }: { count: number }) {
  const tab = "rounded-[10px] px-4 py-2.5 text-[17px] font-bold text-ink-foreground/85 hover:text-ink-foreground"
  return (
    <header className="sticky top-0 z-20 hidden items-center gap-2 bg-ink px-7 py-3.5 text-ink-foreground lg:flex">
      <p className="mr-4 text-xl font-extrabold">LSP</p>
      <nav aria-label="Main" className="flex items-center gap-1">
        <Link href="/board?view=board" className={tab}>
          Board
        </Link>
        <Link href="/board?view=mine" className={tab}>
          My jobs
        </Link>
        <Link
          href="/review"
          aria-current="page"
          className="rounded-[10px] bg-card px-4 py-2.5 text-[17px] font-bold text-foreground"
        >
          Review{count ? ` · ${count}` : ""}
        </Link>
        <Link href="/setup" className={tab}>
          Setup
        </Link>
      </nav>
    </header>
  )
}

/** Phone: Board and Review, nothing else. */
export function ReviewBottomBar({ count }: { count: number }) {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t border-border bg-card px-3 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden"
    >
      <Link
        href="/board?view=board"
        className="flex h-14 flex-1 items-center justify-center rounded-xl border-2 border-ink bg-card text-[17px] font-bold"
      >
        Board
      </Link>
      <span
        aria-current="page"
        className="flex h-14 flex-1 items-center justify-center rounded-xl bg-ink text-[17px] font-bold text-ink-foreground"
      >
        Review{count ? ` · ${count}` : ""}
      </span>
    </nav>
  )
}
