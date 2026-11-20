"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

import { PartOrderPanel } from "@/components/visit/part-order"
import type { PartsDesk, PartsDeskRow } from "@/lib/parts-data"
import { money, shortDate } from "@/lib/review"

/** Owners: every open part order in one list. Tap one to order it or mark it in hand. */
export function PartsDeskView({ desk }: { desk: PartsDesk }) {
  const [open, setOpen] = useState<string | null>(null)

  // Arriving from Needs you (/parts#order-<id>) opens that order.
  useEffect(() => {
    const id = window.location.hash.replace(/^#order-/, "")
    if (!id) return
    const timer = window.setTimeout(() => {
      setOpen(id)
      document.getElementById(`order-${id}`)?.scrollIntoView({ block: "start" })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  const section = (title: string, rows: PartsDeskRow[], empty: string | null) =>
    rows.length === 0 && empty === null ? null : (
      <section className="flex flex-col gap-2.5">
        <h2 className="text-[13px] font-bold tracking-[0.08em] text-muted-foreground">
          {title}
          {rows.length ? ` · ${rows.length}` : ""}
        </h2>
        {rows.length === 0 ? (
          <p className="rounded-xl border border-border bg-card px-4 py-3 text-[15px] text-muted-foreground">
            {empty}
          </p>
        ) : (
          rows.map((row) => (
            <PartRow
              key={row.part.id}
              row={row}
              open={open === row.part.id}
              onToggle={() => setOpen(open === row.part.id ? null : row.part.id)}
              desk={desk}
            />
          ))
        )}
      </section>
    )

  return (
    <div className="flex flex-col gap-6">
      {section("TO ORDER", desk.toOrder, "Nothing waiting to be ordered.")}
      {section("ON ORDER", desk.onOrder, "Nothing on order.")}
      {section("IN HAND · WAITING ON THE INSTALL", desk.inHand, null)}
    </div>
  )
}

function PartRow({
  row,
  open,
  onToggle,
  desk,
}: {
  row: PartsDeskRow
  open: boolean
  onToggle: () => void
  desk: PartsDesk
}) {
  const { part } = row
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" })
  const late =
    part.status === "ordered" && part.expectedDelivery !== null && part.expectedDelivery < today
  const first = row.techName?.split(" ")[0]
  const detail =
    part.status === "needed"
      ? [
          part.helpAskedAt
            ? `${row.helpByName?.split(" ")[0] ?? "Tech"} asked you to order it`
            : "Not ordered yet",
          first,
        ]
      : part.status === "ordered"
        ? [
            part.supplierName ?? part.contactText ?? "Supplier not picked",
            part.orderNumber ? `#${part.orderNumber}` : null,
            part.expectedDelivery ? `due ${shortDate(part.expectedDelivery)}` : "no date",
            part.quotedCents !== null ? `quoted ${money(part.quotedCents)}` : null,
          ]
        : [
            part.actualCents !== null ? `cost ${money(part.actualCents)}` : null,
            part.hasReceipt ? "receipt ✓" : null,
            first ? `${first} installs` : "assign a tech",
          ]
  return (
    <div
      id={`order-${part.id}`}
      className={
        "scroll-mt-24 rounded-xl bg-card " +
        (open
          ? "border-2 border-primary"
          : part.helpAskedAt && part.status === "needed"
            ? "border-2 border-free-foreground/40"
            : "border border-border")
      }
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full flex-col gap-1 px-4 py-3 text-left"
      >
        <span className="flex w-full justify-between gap-3 text-[17px] font-extrabold">
          <span className="min-w-0 truncate">
            {row.propertyName} {row.unitLabel}
          </span>
          {late ? (
            <span className="shrink-0 rounded-lg bg-destructive/10 px-2 py-0.5 text-[13px] font-bold text-destructive">
              Late
            </span>
          ) : null}
        </span>
        <span className="text-[15px] font-semibold">{part.repairTitle ?? part.description}</span>
        <span className="text-[14px] text-muted-foreground">
          {detail.filter(Boolean).join(" · ")}
        </span>
      </button>
      {open ? (
        <div className="flex flex-col gap-3 border-t border-border px-4 pt-3 pb-4">
          <PartOrderPanel
            requestId={row.requestId}
            part={part}
            suppliers={desk.suppliers}
            modelText={row.model}
            serial={row.serial}
            showHeader={false}
          />
          <Link
            href={`/board/visit/${row.requestId}`}
            className="self-start text-[14px] font-semibold text-primary underline-offset-4 hover:underline"
          >
            Open the job{row.displayNumber ? ` (${row.displayNumber})` : ""}
          </Link>
        </div>
      ) : null}
    </div>
  )
}
