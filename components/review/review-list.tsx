import Link from "next/link"

import { money, reviewTag, type ReviewListItem } from "@/lib/review"

function Card({ item, selected, wide }: { item: ReviewListItem; selected: boolean; wide: boolean }) {
  const tag = reviewTag(item)
  const first = item.techName?.split(" ")[0]
  const href = item.kind === "invoice" ? `/review/invoice/${item.id}` : `/review/estimate/${item.id}`
  return (
    <Link
      href={href}
      aria-current={selected ? "page" : undefined}
      className={
        "flex flex-col gap-1 rounded-xl bg-card px-4 py-3 text-left " +
        (selected ? "border-2 border-primary" : "border border-border hover:border-ink/40")
      }
    >
      <span className={"flex justify-between gap-3 font-extrabold " + (wide ? "text-base" : "text-lg")}>
        <span className="min-w-0 truncate">{item.title}</span>
        <span className="shrink-0 tabular-nums">{money(item.amountCents)}</span>
      </span>
      <span className={"text-muted-foreground " + (wide ? "text-sm" : "text-[15px]")}>
        {[item.summary, first, wide ? item.dateLabel : null].filter(Boolean).join(" · ")}
      </span>
      {tag ? (
        <span
          className={
            "self-start rounded-lg px-2 py-0.5 text-[13px] font-bold " +
            (tag.tone === "amber" ? "bg-free text-free-foreground" : "bg-primary/10 text-primary")
          }
        >
          {tag.text}
        </span>
      ) : null}
    </Link>
  )
}

export function ReviewList({
  items,
  selectedId,
  wide,
}: {
  items: ReviewListItem[]
  selectedId: string | null
  wide: boolean
}) {
  const invoices = items.filter((i) => i.kind === "invoice")
  const estimates = items.filter((i) => i.kind === "estimate")
  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-card px-4 py-5 text-[15px] leading-6 text-muted-foreground">
        Nothing waiting. Drafts show up here when a tech closes a visit.
      </p>
    )
  }
  const heading = (text: string, n: number) => (
    <h2 className="mt-1 text-[13px] font-bold tracking-[0.08em] text-muted-foreground">
      {text}
      {wide ? ` · ${n}` : ""}
    </h2>
  )
  return (
    <div className="flex flex-col gap-2.5">
      {invoices.length ? heading("DRAFT INVOICES", invoices.length) : null}
      {invoices.map((item) => (
        <Card key={item.id} item={item} selected={item.id === selectedId} wide={wide} />
      ))}
      {estimates.length ? heading("DRAFT ESTIMATES", estimates.length) : null}
      {estimates.map((item) => (
        <Card key={item.id} item={item} selected={item.id === selectedId} wide={wide} />
      ))}
    </div>
  )
}

/** "3 invoices · 1 estimate" */
export function reviewCountLine(items: ReviewListItem[]): string {
  const inv = items.filter((i) => i.kind === "invoice").length
  const est = items.filter((i) => i.kind === "estimate").length
  const parts = [
    inv ? `${inv} invoice${inv === 1 ? "" : "s"}` : null,
    est ? `${est} estimate${est === 1 ? "" : "s"}` : null,
  ].filter(Boolean)
  return parts.length ? parts.join(" · ") : "All caught up"
}
