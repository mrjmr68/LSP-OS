"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { confirmPartCost } from "@/app/actions/parts"
import {
  addLine,
  approveAndSend,
  askTech,
  removeLine,
  sendAgain,
  setCostLine,
  setInvoiceRefrigerant,
  updateLine,
  type ReviewResult,
} from "@/app/actions/review"
import type { InvoiceReview as Model } from "@/lib/review-data"
import {
  invoiceTotals,
  longDate,
  moneyExact,
  multiRepairNote,
  parseDollars,
  ratePercent,
} from "@/lib/review"

import { inputClass, LineCard, Panel, RefrigerantCard, Row, smallButton, TimeTiles } from "./review-parts"

type Notice = { tone: "ok" | "error"; text: string } | null

export function InvoiceReview({ model }: { model: Model }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [notice, setNotice] = useState<Notice>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draftText, setDraftText] = useState("")
  const [draftAmount, setDraftAmount] = useState("")
  const [asking, setAsking] = useState(false)
  const [question, setQuestion] = useState("")
  const [confirming, setConfirming] = useState(false)

  const approved = model.status === "approved_sent" || model.status === "paid"
  const unconfirmed = model.lines.filter((l) => l.partCheck && !l.partCheck.confirmed).length
  const readOnly = approved || pending
  const repairs = model.lines.filter((l) => l.source === "bundle").length
  const totals = invoiceTotals(model.lines, model.taxRateBps)
  const first = model.techFirstName

  function run(action: () => Promise<ReviewResult>, after?: () => void) {
    setNotice(null)
    startTransition(async () => {
      const result = await action()
      if (!result.ok) {
        setNotice({ tone: "error", text: result.message })
        return
      }
      if (result.message) setNotice({ tone: "ok", text: result.message })
      after?.()
      router.refresh()
    })
  }

  function startEdit(key: string, text: string, amount: string) {
    setEditing(key)
    setDraftText(text)
    setDraftAmount(amount)
  }

  const timeLine = [model.techName?.split(" ")[0], model.dateLabel].filter(Boolean).join(" · ")
  const totalMinutes = model.minutes.travel + model.minutes.access + model.minutes.work

  const actions = approved ? (
    <>
      <a
        href={`/review/invoice/${model.id}/pdf`}
        target="_blank"
        rel="noreferrer"
        className="flex h-16 flex-1 items-center justify-center rounded-[14px] border-2 border-ink bg-card text-[17px] font-bold lg:h-12 lg:flex-none lg:px-5 lg:text-[15px]"
      >
        Download PDF
      </a>
      {model.emailStatus !== "sent" ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => sendAgain(model.id))}
          className="h-16 flex-1 rounded-[14px] bg-primary text-[19px] font-extrabold text-primary-foreground disabled:opacity-60 lg:h-12 lg:flex-none lg:px-6 lg:text-base"
        >
          {pending ? "Sending…" : "Send again"}
        </button>
      ) : null}
    </>
  ) : confirming ? (
    <div className="flex w-full flex-col gap-2 lg:w-auto lg:items-end">
      <p className="text-[15px] leading-5 font-semibold">
        Send {moneyExact(totals.total)} to {model.billTo.email ?? "(no billing email — you'll get the PDF)"}?
      </p>
      <div className="flex gap-2.5">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="h-14 flex-1 rounded-[14px] border-2 border-ink bg-card px-5 text-[17px] font-bold lg:h-12"
        >
          Not yet
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => approveAndSend(model.id, model.updatedAt), () => setConfirming(false))}
          className="h-14 flex-[1.3] rounded-[14px] bg-primary px-6 text-[19px] font-extrabold text-primary-foreground disabled:opacity-60 lg:h-12 lg:text-base"
        >
          {pending ? "Sending…" : "Send it"}
        </button>
      </div>
    </div>
  ) : (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setAsking(true)
          setQuestion("")
        }}
        className="h-16 flex-1 rounded-[14px] border-2 border-ink bg-card text-[17px] font-bold disabled:opacity-60 lg:h-12 lg:flex-none lg:px-5 lg:text-[15px]"
      >
        Text {first} a question
      </button>
      <button
        type="button"
        disabled={pending || unconfirmed > 0}
        title={unconfirmed > 0 ? "Confirm the part cost first" : undefined}
        onClick={() => setConfirming(true)}
        className="h-16 flex-[1.3] rounded-[14px] bg-primary text-[19px] font-extrabold text-primary-foreground disabled:opacity-50 lg:h-12 lg:flex-none lg:px-6 lg:text-base"
      >
        {unconfirmed > 0 ? "Confirm part cost first" : "Approve and send"}
      </button>
    </>
  )

  return (
    <div className="flex flex-col gap-4 pb-40 lg:pb-8">
      <Link href="/review" className="self-start text-[15px] font-semibold text-muted-foreground lg:hidden">
        ← Needs you
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-bold text-muted-foreground">{timeLine}</p>
          <h1 className="mt-1 text-[28px] leading-tight font-extrabold lg:text-[30px]">
            {model.propertyName} {model.unitLabel}
            {model.issue ? <span className="hidden lg:inline"> · {model.issue}</span> : null}
          </h1>
          {approved ? (
            <p className="mt-1 text-[15px] font-bold text-busy-foreground">
              Invoice {model.number} · approved {model.invoiceDate ? longDate(model.invoiceDate) : ""}
              {model.emailStatus === "sent"
                ? " · emailed"
                : model.emailStatus === "failed"
                  ? " · email failed"
                  : " · not emailed"}
            </p>
          ) : null}
        </div>
        <div className="hidden gap-2.5 lg:flex">{actions}</div>
      </div>

      {notice ? (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={
            "rounded-xl px-4 py-3 text-[15px] leading-6 font-medium " +
            (notice.tone === "error" ? "bg-destructive/10 text-destructive" : "bg-busy text-busy-foreground")
          }
        >
          {notice.text}
        </p>
      ) : null}

      <TimeTiles
        tiles={[
          ["Travel", model.minutes.travel],
          ["Getting in", model.minutes.access],
          ["Work", model.minutes.work],
          ["Total", totalMinutes],
        ]}
      />

      {model.question ? (
        <div className="rounded-xl border-2 border-primary bg-card px-4 py-3 text-[15px] leading-6">
          <p className="font-bold">You asked {first}: “{model.question}”</p>
          {model.answer && model.status !== "flagged" ? (
            <p className="mt-1">
              <span className="font-bold">{first}: </span>“{model.answer}”
            </p>
          ) : (
            <p className="mt-1 text-muted-foreground">Waiting on {first}. The job stays in Complete.</p>
          )}
        </div>
      ) : null}

      {!approved && multiRepairNote(repairs) ? (
        <p className="rounded-xl bg-free px-4 py-3 text-[15px] leading-6 font-semibold text-free-foreground">
          {multiRepairNote(repairs)}
        </p>
      ) : null}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <section className="flex min-w-0 flex-col gap-3 lg:flex-[2]">
          {model.lines.map((line) => (
            <LineCard
              key={line.id}
              line={line}
              canRemoveLine={model.lines.length > 1}
              readOnly={readOnly}
              editing={editing}
              draftText={draftText}
              draftAmount={draftAmount}
              onDraftText={setDraftText}
              onDraftAmount={setDraftAmount}
              onStartEdit={startEdit}
              onCancel={() => setEditing(null)}
              onCost={(cost, change) => run(() => setCostLine(model.id, cost.id, change), () => setEditing(null))}
              onSaveLine={(description, amount) =>
                run(() => updateLine(model.id, line.id, description, amount), () => setEditing(null))
              }
              onRemoveLine={() => run(() => removeLine(model.id, line.id))}
              onConfirmPart={(cents) =>
                run(async () => {
                  const r = await confirmPartCost(model.id, line.id, cents)
                  return r.ok
                    ? {
                        ok: true,
                        message: line.partCheck?.held
                          ? "Part cost confirmed. The approved price holds."
                          : "Part cost confirmed. The price follows it.",
                      }
                    : r
                })
              }
              onError={(text) => setNotice({ tone: "error", text })}
            />
          ))}

          {approved ? null : editing === "new" ? (
            <div className="flex flex-col gap-2 rounded-xl border-2 border-dashed border-muted-foreground bg-card p-3">
              <label className="text-sm font-bold" htmlFor="new-line-text">
                What the property reads
              </label>
              <input
                id="new-line-text"
                className={inputClass}
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                placeholder="e.g. Same-trip discount"
              />
              <label className="text-sm font-bold" htmlFor="new-line-amount">
                Amount (a minus sign for a discount)
              </label>
              <input
                id="new-line-amount"
                className={inputClass}
                inputMode="decimal"
                value={draftAmount}
                onChange={(e) => setDraftAmount(e.target.value)}
                placeholder="-25"
              />
              <div className="flex gap-2">
                <button type="button" className={smallButton + " h-11 flex-1"} onClick={() => setEditing(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={pending}
                  className="h-11 flex-1 rounded-lg bg-primary text-[15px] font-bold text-primary-foreground disabled:opacity-60"
                  onClick={() => {
                    const cents = parseDollars(draftAmount)
                    if (cents === null) {
                      setNotice({ tone: "error", text: "Type the amount in dollars, like 25 or -25." })
                      return
                    }
                    run(() => addLine(model.id, draftText, cents), () => setEditing(null))
                  }}
                >
                  Add line
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={readOnly}
              onClick={() => startEdit("new", "", "")}
              className="h-12 rounded-xl border-2 border-dashed border-muted-foreground bg-card text-base font-bold disabled:opacity-50"
            >
              Add a line
            </button>
          )}

          <RefrigerantCard
            refrigerant={model.refrigerant}
            techFirstName={first}
            readOnly={readOnly}
            onSave={(type, lbs) => run(() => setInvoiceRefrigerant(model.id, type, lbs))}
            onError={(text) => setNotice({ tone: "error", text })}
          />

          <div className="flex flex-col gap-1 rounded-xl border border-border bg-card px-4 py-3">
            <Row label="Subtotal" value={moneyExact(model.subtotalCents)} />
            <Row label={`Sales tax (${ratePercent(model.taxRateBps)})`} value={moneyExact(model.taxCents)} />
            <div className="mt-1 flex justify-between text-xl font-extrabold">
              <span>Property sees</span>
              <span className="tabular-nums">{moneyExact(model.totalCents)}</span>
            </div>
          </div>
        </section>

        <aside className="flex flex-col gap-3 lg:flex-1">
          <Panel title="WHAT THE PROPERTY READS">
            {model.lines.map((l) => (
              <p key={l.id}>{l.description}</p>
            ))}
          </Panel>
          {model.note || model.photoCount || model.oneOffNarrative || model.materials ? (
            <Panel title={`FROM ${first.toUpperCase()}`}>
              {model.note ? <p>“{model.note}”</p> : null}
              {model.oneOffNarrative && model.oneOffNarrative !== model.note ? <p>{model.oneOffNarrative}</p> : null}
              {model.materials ? <p>Materials: {model.materials}</p> : null}
              {model.photoCount ? (
                <p className="text-muted-foreground">
                  {model.photoCount} photo{model.photoCount === 1 ? "" : "s"} on the visit
                </p>
              ) : null}
            </Panel>
          ) : null}
          <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm leading-6 text-muted-foreground">
            Bills to {model.billTo.name ?? "the customer's billing contact"}
            {model.billTo.email ? ` · ${model.billTo.email}` : " · no email on file"} ·{" "}
            {model.billTo.termsDays === 0 ? "due on receipt" : `net ${model.billTo.termsDays}`}
            {approved && model.dueDate ? ` · due ${longDate(model.dueDate)}` : ""}
          </p>
        </aside>
      </div>

      {/* Phone: the two actions pinned to the bottom */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex gap-2.5 border-t border-border bg-card px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] lg:hidden">
        {actions}
      </div>

      {asking ? (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-foreground/40 md:items-center"
          onMouseDown={() => setAsking(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ask-title"
            className="w-full rounded-t-2xl bg-background px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:max-w-lg md:rounded-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="ask-title" className="text-2xl font-extrabold">
              Ask {first}
            </h2>
            <p className="mt-1 text-[15px] text-muted-foreground">
              {first} sees it on My jobs and answers there. The job stays in Complete.
            </p>
            <textarea
              autoFocus
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              className="mt-3 min-h-28 w-full rounded-lg border border-input bg-card px-3 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              placeholder="Was the drain on the same unit?"
            />
            <div className="mt-3 flex gap-2.5">
              <button
                type="button"
                onClick={() => setAsking(false)}
                className="h-14 flex-1 rounded-[14px] border-2 border-ink bg-card text-[17px] font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={pending || question.trim() === ""}
                onClick={() => run(() => askTech(model.id, question), () => setAsking(false))}
                className="h-14 flex-[1.3] rounded-[14px] bg-primary text-[18px] font-extrabold text-primary-foreground disabled:opacity-50"
              >
                {pending ? "Sending…" : "Send question"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
