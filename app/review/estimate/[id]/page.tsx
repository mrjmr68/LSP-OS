import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { ReviewTopBar } from "@/components/review/review-chrome"
import { ReviewList } from "@/components/review/review-list"
import { moneyExact } from "@/lib/review"
import { loadEstimateReview, loadReviewList, requireReviewer } from "@/lib/review-data"
import { isUuid } from "@/lib/setup"

export const metadata: Metadata = { title: "Draft estimate" }

export default async function ReviewEstimatePage({ params }: PageProps<"/review/estimate/[id]">) {
  const { id } = await params
  if (!isUuid(id)) notFound()
  const { supabase } = await requireReviewer()
  const [est, items] = await Promise.all([loadEstimateReview(supabase, id), loadReviewList(supabase)])
  if (!est) notFound()
  return (
    <div className="flex min-h-full flex-col">
      <ReviewTopBar count={items.length} />
      <main className="mx-auto flex w-full max-w-[1360px] flex-1 gap-6 px-5 pt-5 pb-10 lg:px-7 lg:pt-6">
        <aside className="hidden w-[340px] shrink-0 lg:block">
          <ReviewList items={items} selectedId={id} wide />
        </aside>
        <div className="flex min-w-0 max-w-2xl flex-1 flex-col gap-4">
          <Link href="/review" className="self-start text-[15px] font-semibold text-muted-foreground lg:hidden">
            ← Needs you
          </Link>
          <div>
            <p className="text-[15px] font-bold text-muted-foreground">
              {[est.techName?.split(" ")[0], est.dateLabel, est.equipmentSize].filter(Boolean).join(" · ")}
            </p>
            <h1 className="mt-1 text-[28px] leading-tight font-extrabold">
              Estimate · {est.propertyName} {est.unitLabel}
            </h1>
          </div>
          <p className="rounded-xl bg-free px-4 py-3 text-[15px] leading-6 font-semibold text-free-foreground">
            Editing and sending estimates comes with the Parts and Estimates stage. For now this
            shows what the tech drafted.
          </p>
          <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-card px-4 py-3">
            {est.lines.map((l) => (
              <div key={l.id} className="flex justify-between gap-3 text-[17px] font-bold">
                <span>{l.title}</span>
                <span className="tabular-nums">{moneyExact(l.amountCents)}</span>
              </div>
            ))}
            <div className="mt-2 flex justify-between text-[15px] text-muted-foreground">
              <span>Subtotal</span>
              <span>{moneyExact(est.subtotalCents)}</span>
            </div>
            <div className="flex justify-between text-[15px] text-muted-foreground">
              <span>Sales tax</span>
              <span>{moneyExact(est.taxCents)}</span>
            </div>
            <div className="flex justify-between text-xl font-extrabold">
              <span>Property sees</span>
              <span>{moneyExact(est.totalCents)}</span>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm leading-6">
            <p className="text-xs font-bold tracking-[0.08em] text-muted-foreground">WHY AN ESTIMATE</p>
            <p>{est.narrative}</p>
          </div>
        </div>
      </main>
    </div>
  )
}
