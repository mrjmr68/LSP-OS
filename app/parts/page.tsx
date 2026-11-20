import type { Metadata } from "next"

import { PartsDeskView } from "@/components/parts/parts-desk"
import { ReviewBottomBar, ReviewTopBar } from "@/components/review/review-chrome"
import { loadPartsDesk } from "@/lib/parts-data"
import { countReview, requireReviewer } from "@/lib/review-data"

export const metadata: Metadata = { title: "Parts" }

export default async function PartsPage() {
  const { supabase } = await requireReviewer()
  const [desk, reviewCount] = await Promise.all([loadPartsDesk(supabase), countReview(supabase)])
  const open = desk.toOrder.length + desk.onOrder.length
  return (
    <div className="flex min-h-full flex-col">
      <ReviewTopBar count={reviewCount} active="parts" />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-5 pt-6 pb-28 lg:px-7 lg:pb-10">
        <div>
          <h1 className="text-[32px] leading-tight font-extrabold">Parts</h1>
          <p className="text-base text-muted-foreground">
            {open === 0
              ? "Nothing to order or waiting to arrive."
              : [
                  desk.toOrder.length ? `${desk.toOrder.length} to order` : null,
                  desk.onOrder.length ? `${desk.onOrder.length} on order` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
          </p>
        </div>
        <PartsDeskView desk={desk} />
      </main>
      <ReviewBottomBar count={reviewCount} active="parts" />
    </div>
  )
}
