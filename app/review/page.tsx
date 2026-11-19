import type { Metadata } from "next"

import { ReviewBottomBar, ReviewTopBar } from "@/components/review/review-chrome"
import { ReviewList, reviewCountLine } from "@/components/review/review-list"
import { loadReviewList, requireReviewer } from "@/lib/review-data"

export const metadata: Metadata = { title: "Needs you" }

export default async function ReviewPage() {
  const { supabase } = await requireReviewer()
  const items = await loadReviewList(supabase)
  return (
    <div className="flex min-h-full flex-col">
      <ReviewTopBar count={items.length} />
      <main className="mx-auto flex w-full max-w-[1360px] flex-1 flex-col gap-5 px-5 pt-6 pb-28 lg:flex-row lg:gap-6 lg:px-7 lg:pb-8">
        <div className="flex w-full flex-col gap-4 lg:max-w-[380px]">
          <div>
            <h1 className="text-[32px] leading-tight font-extrabold">Needs you</h1>
            <p className="text-base text-muted-foreground">{reviewCountLine(items)}</p>
          </div>
          <ReviewList items={items} selectedId={null} wide={false} />
        </div>
        <div className="hidden flex-1 items-start lg:flex">
          <p className="rounded-xl border border-border bg-card px-5 py-4 text-[15px] leading-6 text-muted-foreground">
            Pick a draft on the left. Every cost line of every repair is shown; remove or change
            what doesn&apos;t apply, then approve and send.
          </p>
        </div>
      </main>
      <ReviewBottomBar count={items.length} />
    </div>
  )
}
