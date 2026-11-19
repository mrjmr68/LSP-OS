import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { InvoiceReview } from "@/components/review/invoice-review"
import { ReviewTopBar } from "@/components/review/review-chrome"
import { ReviewList } from "@/components/review/review-list"
import { loadInvoiceReview, loadReviewList, requireReviewer } from "@/lib/review-data"
import { isUuid } from "@/lib/setup"

export const metadata: Metadata = { title: "Review invoice" }

export default async function ReviewInvoicePage({ params }: PageProps<"/review/invoice/[id]">) {
  const { id } = await params
  if (!isUuid(id)) notFound()
  const { supabase } = await requireReviewer()
  const [model, items] = await Promise.all([loadInvoiceReview(supabase, id), loadReviewList(supabase)])
  if (!model) notFound()
  return (
    <div className="flex min-h-full flex-col">
      <ReviewTopBar count={items.length} />
      <main className="mx-auto flex w-full max-w-[1360px] flex-1 gap-6 px-5 pt-5 lg:px-7 lg:pt-6">
        <aside className="hidden w-[340px] shrink-0 lg:block">
          <ReviewList items={items} selectedId={id} wide />
        </aside>
        <div className="min-w-0 flex-1">
          <InvoiceReview key={`${model.id}:${model.updatedAt}`} model={model} />
        </div>
      </main>
    </div>
  )
}
