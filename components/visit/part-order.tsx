"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { askOwnerForPart, orderPart, receivePart } from "@/app/actions/parts"
import { prepareForReading } from "@/lib/photo-read"
import { moneyExact, parseDollars } from "@/lib/review"
import type { VisitPart, VisitSupplier } from "@/lib/visit-data"

const field =
  "h-12 w-full rounded-xl border-2 border-ink/70 bg-card px-3 text-[17px] outline-none focus-visible:border-primary"

/** One part order: order it, then mark it in hand with the real cost and receipt. */
export function PartOrderPanel({
  requestId,
  part,
  suppliers,
  modelText,
  serial,
  canAskOwner = false,
  showHeader = true,
}: {
  requestId: string
  part: VisitPart
  suppliers: VisitSupplier[]
  modelText: string
  serial: string
  /** Techs can hand the ordering to an owner. */
  canAskOwner?: boolean
  /** The Parts tab shows its own header row. */
  showHeader?: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
  const [form, setForm] = useState({
    description: part.description,
    supplierId: part.supplierId ?? "",
    supplierContact: part.contactText ?? "",
    orderNumber: part.orderNumber,
    partNumber: part.partNumber,
    quoted: part.quotedCents === null ? "" : (part.quotedCents / 100).toFixed(2),
    expected: part.expectedDelivery ?? "",
  })
  const [actual, setActual] = useState(part.actualCents === null ? "" : (part.actualCents / 100).toFixed(2))
  const [receipt, setReceipt] = useState<string | null>(null)
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))
  const supplier = suppliers.find((s) => s.id === form.supplierId) ?? null
  const inHand = part.status === "in_hand"
  const id = (k: string) => `${part.id}-${k}`

  function saveOrder() {
    const quoted = form.quoted.trim() === "" ? null : parseDollars(form.quoted)
    if (form.quoted.trim() !== "" && quoted === null) {
      setNotice({ tone: "error", text: "Type the quoted cost in dollars, like 358." })
      return
    }
    start(async () => {
      const r = await orderPart({
        requestId,
        partsOrderId: part.id,
        description: form.description,
        supplierId: form.supplierId || null,
        supplierContact: form.supplierContact,
        orderNumber: form.orderNumber,
        partNumber: form.partNumber,
        quotedCents: quoted,
        expectedDelivery: form.expected || null,
      })
      setNotice(r.ok ? { tone: "ok", text: "Order saved." } : { tone: "error", text: r.message })
      if (r.ok) router.refresh()
    })
  }

  function markInHand() {
    const cents = parseDollars(actual)
    if (cents === null || cents < 0) {
      setNotice({ tone: "error", text: "Type what the part actually cost, from the receipt." })
      return
    }
    if (part.variable && !receipt && !part.hasReceipt) {
      setNotice({ tone: "error", text: "Take a photo of the receipt first. This repair is priced on the real part cost." })
      return
    }
    start(async () => {
      const r = await receivePart({ requestId, partsOrderId: part.id, actualCents: cents, receipt })
      setNotice(
        r.ok ? { tone: "ok", text: "Part in hand. The job is Ready for the return visit." } : { tone: "error", text: r.message },
      )
      if (r.ok) router.refresh()
    })
  }

  function askOwner() {
    start(async () => {
      const r = await askOwnerForPart(requestId, part.id)
      setNotice(r.ok ? { tone: "ok", text: "Asked. It's in the owners' Needs you list." } : { tone: "error", text: r.message })
      if (r.ok) router.refresh()
    })
  }

  const status = inHand ? "In hand" : part.status === "ordered" ? "Ordered" : "Needs ordering"
  return (
    <section
      className={
        showHeader ? "flex flex-col gap-3 rounded-xl border border-border bg-card p-4" : "flex flex-col gap-3"
      }
    >
      {part.status === "needed" && part.helpAskedAt && showHeader ? (
        <p className="rounded-lg bg-free px-3 py-2 text-[14px] leading-5 font-semibold text-free-foreground">
          An owner was asked to order this.
        </p>
      ) : canAskOwner && part.status === "needed" ? (
        <button
          type="button"
          disabled={pending}
          onClick={askOwner}
          className="h-12 rounded-xl border-2 border-dashed border-ink/60 bg-card text-[16px] font-bold disabled:opacity-60"
        >
          Ask an owner to order it
        </button>
      ) : null}
      <div className={showHeader ? "flex items-start justify-between gap-3" : "hidden"}>
        <div className="min-w-0">
          <p className="text-[13px] font-bold tracking-[0.08em] text-muted-foreground uppercase">Part for</p>
          <p className="text-[19px] leading-snug font-extrabold">{part.repairTitle ?? part.description}</p>
          <p className="text-[14px] text-muted-foreground tabular-nums">
            Model {modelText || "—"} · Serial {serial || "—"}
          </p>
        </div>
        <span
          className={
            "shrink-0 rounded-md px-2 py-1 text-[13px] font-bold " +
            (inHand ? "bg-busy text-busy-foreground" : "bg-free text-free-foreground")
          }
        >
          {status}
        </span>
      </div>
      {part.variable ? (
        <p className="rounded-lg bg-free px-3 py-2 text-[14px] leading-5 font-medium text-free-foreground">
          Priced on the real part cost. The actual cost and a receipt photo are needed to mark it in hand.
        </p>
      ) : null}

      {inHand ? (
        <dl className="grid grid-cols-2 gap-2 text-[15px]">
          <div>
            <dt className="text-[13px] text-muted-foreground">Quoted</dt>
            <dd className="font-bold tabular-nums">{part.quotedCents === null ? "—" : moneyExact(part.quotedCents)}</dd>
          </div>
          <div>
            <dt className="text-[13px] text-muted-foreground">Actual</dt>
            <dd className="font-bold tabular-nums">
              {part.actualCents === null ? "—" : moneyExact(part.actualCents)}
              {part.hasReceipt ? " · receipt ✓" : ""}
            </dd>
          </div>
        </dl>
      ) : (
        <>
          <p className="text-[13px] font-bold tracking-[0.08em] text-muted-foreground uppercase">Order it</p>
          <div className="flex flex-col gap-1">
            <label htmlFor={id("desc")} className="text-[15px] font-semibold">
              Part
            </label>
            <input id={id("desc")} value={form.description} onChange={(e) => set("description", e.target.value)} className={field} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={id("supplier")} className="text-[15px] font-semibold">
              Supplier
            </label>
            <select id={id("supplier")} value={form.supplierId} onChange={(e) => set("supplierId", e.target.value)} className={field}>
              <option value="">Not picked yet</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          {supplier?.phone ? (
            <a
              href={`tel:${supplier.phone}`}
              className="flex h-12 items-center justify-center rounded-xl border-2 border-ink text-[16px] font-bold"
            >
              Call {supplier.name}
            </a>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={id("order")} className="text-[15px] font-semibold">
                Order #
              </label>
              <input id={id("order")} value={form.orderNumber} onChange={(e) => set("orderNumber", e.target.value)} className={field} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={id("pn")} className="text-[15px] font-semibold">
                Part #
              </label>
              <input id={id("pn")} value={form.partNumber} onChange={(e) => set("partNumber", e.target.value)} className={field} autoCapitalize="characters" />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={id("quoted")} className="text-[15px] font-semibold">
                Quoted cost
              </label>
              <input id={id("quoted")} value={form.quoted} onChange={(e) => set("quoted", e.target.value)} inputMode="decimal" placeholder="$" className={field} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={id("eta")} className="text-[15px] font-semibold">
                Expected
              </label>
              <input id={id("eta")} type="date" value={form.expected} onChange={(e) => set("expected", e.target.value)} className={field} />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={id("note")} className="text-[15px] font-semibold">
              Supplier note
            </label>
            <input id={id("note")} value={form.supplierContact} onChange={(e) => set("supplierContact", e.target.value)} placeholder="Branch, who you talked to" className={field} />
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={saveOrder}
            className="h-12 rounded-xl border-2 border-ink bg-card text-[17px] font-bold disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save order"}
          </button>

          <div className="mt-2 flex flex-col gap-2 border-t border-border pt-3">
            <p className="text-[13px] font-bold tracking-[0.08em] text-muted-foreground uppercase">Part in hand</p>
            <div className="flex flex-col gap-1">
              <label htmlFor={id("actual")} className="text-[15px] font-semibold">
                Actual cost, from the receipt
              </label>
              <input id={id("actual")} value={actual} onChange={(e) => setActual(e.target.value)} inputMode="decimal" placeholder="$" className={field} />
            </div>
            <label className="flex h-12 cursor-pointer items-center justify-center rounded-xl border-2 border-ink bg-card text-[16px] font-bold">
              {receipt ? "Receipt photo ✓ · retake" : part.variable ? "Photo of the receipt · required" : "Photo of the receipt"}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ""
                  if (file) void prepareForReading(file).then((url) => setReceipt(url || null))
                }}
              />
            </label>
            {receipt ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={receipt} alt="Receipt" className="max-h-48 w-full rounded-lg object-contain" />
            ) : null}
            <button
              type="button"
              disabled={pending || actual.trim() === "" || (part.variable && !receipt && !part.hasReceipt)}
              onClick={markInHand}
              className="h-14 rounded-xl bg-primary text-[18px] font-extrabold text-primary-foreground disabled:opacity-50"
            >
              {pending ? "Saving…" : "Part in hand"}
            </button>
          </div>
        </>
      )}

      {notice ? (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={
            "rounded-lg px-3 py-2 text-[14px] leading-5 font-medium " +
            (notice.tone === "error" ? "bg-destructive/10 text-destructive" : "bg-busy text-busy-foreground")
          }
        >
          {notice.text}
        </p>
      ) : null}
    </section>
  )
}
