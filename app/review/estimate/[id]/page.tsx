import type { Metadata } from "next"
import { headers } from "next/headers"
import { notFound } from "next/navigation"

import { EstimateReview } from "@/components/review/estimate-review"
import { ReviewTopBar } from "@/components/review/review-chrome"
import { ReviewList } from "@/components/review/review-list"
import { loadEstimateReview, loadReviewList, requireReviewer } from "@/lib/review-data"
import { isUuid } from "@/lib/setup"

export const metadata: Metadata = { title: "Estimate" }

export default async function ReviewEstimatePage({ params }: PageProps<"/review/estimate/[id]">) {
  const { id } = await params
  if (!isUuid(id)) notFound()
  const { supabase } = await requireReviewer()
  const [model, items] = await Promise.all([loadEstimateReview(supabase, id), loadReviewList(supabase)])
  if (!model) notFound()
  let link: string | null = null
  if (model.token && model.status !== "draft" && model.status !== "in_review") {
    const h = await headers()
    const host = h.get("x-forwarded-host") ?? h.get("host")
    const proto = h.get("x-forwarded-proto") ?? "https"
    link = host ? `${proto}://${host}/e/${model.token}` : null
  }
  return (
    <div className="flex min-h-full flex-col">
      <ReviewTopBar count={items.length} />
      <main className="mx-auto flex w-full max-w-[1360px] flex-1 gap-6 px-5 pt-5 lg:px-7 lg:pt-6">
        <aside className="hidden w-[340px] shrink-0 lg:block">
          <ReviewList items={items} selectedId={id} wide />
        </aside>
        <div className="min-w-0 flex-1">
          <EstimateReview key={`${model.id}:${model.updatedAt}`} model={model} link={link} />
        </div>
      </main>
    </div>
  )
}
