"use client"

import { useState } from "react"

import {
  minutesShort,
  money,
  parseDollars,
  type ReviewCostLine,
  type ReviewLine,
} from "@/lib/review"

// Pieces shared by the invoice and estimate review screens.

export const inputClass =
  "h-11 w-full rounded-lg border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
export const smallButton =
  "h-9 shrink-0 rounded-lg border border-muted-foreground px-3 text-[13px] font-bold disabled:opacity-50"

/** How long the visit took, big enough to price against. */
export function TimeTiles({ tiles }: { tiles: [string, number][] }) {
  return (
    <section aria-label="Time on this visit" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {tiles.map(([label, minutes], i) => {
        const total = i === tiles.length - 1
        return (
          <div
            key={label}
            className={
              "flex min-w-0 flex-col rounded-xl px-3 py-2.5 " +
              (total ? "bg-ink text-ink-foreground" : "border border-border bg-card")
            }
          >
            <span
              className={
                "truncate text-[12px] font-bold tracking-[0.06em] uppercase " +
                (total ? "text-ink-foreground/75" : "text-muted-foreground")
              }
            >
              {label}
            </span>
            <span className="text-[24px] leading-tight font-extrabold whitespace-nowrap tabular-nums lg:text-[26px]">
              {minutes > 0 ? minutesShort(minutes) : "—"}
            </span>
          </div>
        )
      })}
    </section>
  )
}

/** The owner checks a variable-cost repair's part cost against the bill. */
export function PartCheckBox({
  check,
  readOnly,
  onConfirm,
  onError,
}: {
  check: NonNullable<ReviewLine["partCheck"]>
  readOnly: boolean
  onConfirm: (cents: number) => void
  onError: (text: string) => void
}) {
  const start = check.actualCents ?? check.currentCents
  const [value, setValue] = useState(start === null ? "" : (start / 100).toFixed(2))
  const cell = (label: string, cents: number | null) => (
    <div>
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className="font-bold tabular-nums">{cents === null ? "—" : money(cents)}</dd>
    </div>
  )
  return (
    <div
      className={
        "mt-1 flex flex-col gap-2 rounded-lg px-3 py-2.5 " +
        (check.confirmed ? "bg-busy text-busy-foreground" : "bg-free text-free-foreground")
      }
    >
      <p className="text-[13px] font-bold tracking-[0.06em] uppercase">
        {check.confirmed ? "Part cost confirmed" : "Confirm the part cost"}
      </p>
      <dl className="grid grid-cols-3 gap-2 text-[14px]">
        {cell("Price book", check.referenceCents)}
        {cell("Quoted", check.quotedCents)}
        {cell("Receipt", check.actualCents)}
      </dl>
      {check.receiptUrl ? (
        <a
          href={check.receiptUrl}
          target="_blank"
          rel="noreferrer"
          className="text-[14px] font-bold underline"
        >
          View receipt photo
        </a>
      ) : (
        <p className="text-[13px]">No receipt photo on this job.</p>
      )}
      {readOnly ? null : (
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor={`part-${check.referenceCents}-${start}`}>
            Actual part cost
          </label>
          <input
            id={`part-${check.referenceCents}-${start}`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode="decimal"
            className="h-11 w-28 rounded-lg border border-input bg-card px-3 text-right text-base text-foreground tabular-nums"
          />
          <button
            type="button"
            onClick={() => {
              const cents = parseDollars(value)
              if (cents === null || cents < 0) {
                onError("Type the part cost in dollars, like 412.50.")
                return
              }
              onConfirm(cents)
            }}
            className="h-11 rounded-lg bg-ink px-4 text-[15px] font-bold text-ink-foreground"
          >
            {check.confirmed ? "Update" : "Confirm"}
          </button>
        </div>
      )}
      <p className="text-[12px] leading-4">
        {check.held
          ? "Approved estimate: the price holds. Profit takes the difference."
          : "The price moves with this cost, dollar for dollar. Profit stays the same."}
      </p>
    </div>
  )
}

export function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-[15px] text-muted-foreground">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}

export function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-card px-4 py-3 text-sm leading-6">
      <p className="text-xs font-bold tracking-[0.08em] text-muted-foreground">{title}</p>
      {children}
    </div>
  )
}

export function LineCard({
  line,
  canRemoveLine,
  readOnly,
  editing,
  draftText,
  draftAmount,
  onDraftText,
  onDraftAmount,
  onStartEdit,
  onCancel,
  onCost,
  onSaveLine,
  onRemoveLine,
  onConfirmPart,
  onError,
  docName = "invoice",
}: {
  docName?: "invoice" | "estimate"
  line: ReviewLine
  canRemoveLine: boolean
  readOnly: boolean
  editing: string | null
  draftText: string
  draftAmount: string
  onDraftText: (v: string) => void
  onDraftAmount: (v: string) => void
  onStartEdit: (key: string, text: string, amount: string) => void
  onCancel: () => void
  onCost: (cost: ReviewCostLine, change: { removed?: boolean; amountCents?: number }) => void
  onSaveLine: (description: string, amount: number | null) => void
  onRemoveLine: () => void
  onConfirmPart: (cents: number) => void
  onError: (text: string) => void
}) {
  const hasCosts = line.costLines.length > 0
  const wordingKey = `words:${line.id}`
  const heading = line.title ?? (line.source === "adjustment" ? "Added line" : "One-off")

  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex items-start justify-between gap-3 text-[17px] font-extrabold">
        <span className="min-w-0">{heading}</span>
        <span className="shrink-0 tabular-nums">{money(line.amountCents)}</span>
      </div>

      {line.costLines.map((cost) => {
        const key = `cost:${cost.id}`
        if (editing === key) {
          return (
            <div key={cost.id} className="flex items-center gap-2 py-1">
              <span className="min-w-0 flex-1 text-[15px]">{cost.label}</span>
              <input
                autoFocus
                aria-label={`${cost.label} amount`}
                className={inputClass + " h-10 w-24 flex-none text-right"}
                inputMode="decimal"
                value={draftAmount}
                onChange={(e) => onDraftAmount(e.target.value)}
              />
              <button type="button" className={smallButton} onClick={onCancel}>
                Cancel
              </button>
              <button
                type="button"
                className="h-9 rounded-lg bg-primary px-3 text-[13px] font-bold text-primary-foreground"
                onClick={() => {
                  const cents = parseDollars(draftAmount)
                  if (cents === null) {
                    onError("Type the amount in dollars, like 45.")
                    return
                  }
                  onCost(cost, { amountCents: cents })
                }}
              >
                Save
              </button>
            </div>
          )
        }
        return (
          <div
            key={cost.id}
            className="flex min-h-9 items-center justify-between gap-3 text-[15px] text-muted-foreground"
          >
            <span className={"min-w-0 " + (cost.removed ? "line-through" : "")}>
              {cost.label}
              {cost.removed ? ` · ${money(cost.amountCents)}` : ""}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {cost.removed ? null : (
                <span className="tabular-nums">{money(cost.amountCents)}</span>
              )}
              {readOnly ? null : cost.removed ? (
                <button
                  type="button"
                  className={smallButton + " text-foreground"}
                  onClick={() => onCost(cost, { removed: false })}
                >
                  Put back
                </button>
              ) : cost.kind === "profit" ? (
                <button
                  type="button"
                  className={smallButton}
                  onClick={() => onStartEdit(key, "", (cost.amountCents / 100).toString())}
                >
                  Edit
                </button>
              ) : (
                <button
                  type="button"
                  className={smallButton}
                  onClick={() => onCost(cost, { removed: true })}
                >
                  Remove
                </button>
              )}
            </span>
          </div>
        )
      })}

      {line.partCheck ? (
        <PartCheckBox
          check={line.partCheck}
          readOnly={readOnly}
          onConfirm={onConfirmPart}
          onError={onError}
        />
      ) : null}

      {editing === wordingKey ? (
        <div className="mt-1 flex flex-col gap-2">
          <label className="text-sm font-bold" htmlFor={`${line.id}-words`}>
            What the property reads
          </label>
          <textarea
            id={`${line.id}-words`}
            autoFocus
            value={draftText}
            onChange={(e) => onDraftText(e.target.value)}
            className="min-h-20 w-full rounded-lg border border-input bg-card px-3 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          {hasCosts ? null : (
            <>
              <label className="text-sm font-bold" htmlFor={`${line.id}-amount`}>
                Amount
              </label>
              <input
                id={`${line.id}-amount`}
                className={inputClass}
                inputMode="decimal"
                value={draftAmount}
                onChange={(e) => onDraftAmount(e.target.value)}
              />
            </>
          )}
          <div className="flex gap-2">
            <button type="button" className={smallButton + " h-11 flex-1"} onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              className="h-11 flex-1 rounded-lg bg-primary text-[15px] font-bold text-primary-foreground"
              onClick={() => {
                let amount: number | null = null
                if (!hasCosts) {
                  amount = parseDollars(draftAmount)
                  if (amount === null) {
                    onError("Type the amount in dollars, like 165.")
                    return
                  }
                }
                onSaveLine(draftText, amount)
              }}
            >
              Save
            </button>
          </div>
        </div>
      ) : readOnly ? null : (
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[14px] font-semibold">
          <button
            type="button"
            className="text-primary underline-offset-4 hover:underline"
            onClick={() =>
              onStartEdit(wordingKey, line.description, (line.amountCents / 100).toString())
            }
          >
            {hasCosts ? "Edit wording" : "Edit wording or amount"}
          </button>
          {canRemoveLine ? (
            <button
              type="button"
              className="text-muted-foreground underline-offset-4 hover:underline"
              onClick={onRemoveLine}
            >
              Take off {docName}
            </button>
          ) : null}
        </div>
      )}
    </div>
  )
}
