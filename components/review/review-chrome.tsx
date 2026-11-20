import Link from "next/link"

type Active = "review" | "parts"

/** Desktop: the same dark bar as the Board, with Review or Parts lit. */
export function ReviewTopBar({ count, active = "review" }: { count: number; active?: Active }) {
  const tab = "rounded-[10px] px-4 py-2.5 text-[17px] font-bold text-ink-foreground/85 hover:text-ink-foreground"
  const lit = "rounded-[10px] bg-card px-4 py-2.5 text-[17px] font-bold text-foreground"
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
        <Link href="/review" aria-current={active === "review" ? "page" : undefined} className={active === "review" ? lit : tab}>
          Review{count ? ` · ${count}` : ""}
        </Link>
        <Link href="/parts" aria-current={active === "parts" ? "page" : undefined} className={active === "parts" ? lit : tab}>
          Parts
        </Link>
        <Link href="/setup" className={tab}>
          Setup
        </Link>
      </nav>
    </header>
  )
}

/** Phone: Board, Review and Parts. */
export function ReviewBottomBar({ count, active = "review" }: { count: number; active?: Active }) {
  const off =
    "flex h-14 min-w-0 flex-1 items-center justify-center rounded-xl border-2 border-ink bg-card px-2 text-[17px] font-bold whitespace-nowrap"
  const on =
    "flex h-14 min-w-0 flex-1 items-center justify-center rounded-xl bg-ink px-2 text-[17px] font-bold whitespace-nowrap text-ink-foreground"
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t border-border bg-card px-3 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden"
    >
      <Link href="/board?view=board" className={off}>
        Board
      </Link>
      <Link href="/review" aria-current={active === "review" ? "page" : undefined} className={active === "review" ? on : off}>
        Review{count ? ` · ${count}` : ""}
      </Link>
      <Link href="/parts" aria-current={active === "parts" ? "page" : undefined} className={active === "parts" ? on : off}>
        Parts
      </Link>
    </nav>
  )
}
