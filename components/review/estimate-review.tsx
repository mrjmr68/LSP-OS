"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import {
  addEstimateLine,
  recordEstimateAnswer,
  removeEstimateLine,
  sendEstimate,
  sendEstimateAgain,
  setEstimateCostLine,
  settleDeclined,
  updateEstimateDetails,
  updateEstimateLine,
} from "@/app/actions/estimates"
import type { ReviewResult } from "@/app/actions/review"
import type { EstimateReview as Model } from "@/lib/review-data"
import {
  estimateStatusLine,
  moneyExact,
  multiRepairNote,
  parseDollars,
  ratePercent,
} from "@/lib/review"

import { inputClass, LineCard, Panel, Row, smallButton, TimeTiles } from "./review-parts"

type Notice = { tone: "ok" | "error"; text: string } | null

const bigPrimary =
  "h-16 flex-[1.3] rounded-[14px] bg-primary text-[19px] font-extrabold text-primary-foreground disabled:opacity-50 lg:h-12 lg:flex-none lg:px-6 lg:text-base"
const bigOutline =
  "flex h-16 flex-1 items-center justify-center rounded-[14px] border-2 border-ink bg-card text-[17px] font-bold disabled:opacity-60 lg:h-12 lg:flex-none lg:px-5 lg:text-[15px]"

export function EstimateReview({ model, link }: { model: Model; link: string | null }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [notice, setNotice] = useState<Notice>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draftText, setDraftText] = useState("")
  const [draftAmount, setDraftAmount] = useState("")
  const [confirming, setConfirming] = useState(false)
  const [answer, setAnswer] = useState<"yes" | "no" | null>(null)
  const [answerNote, setAnswerNote] = useState("")
  const [reason, setReason] = useState(model.narrative)
  const [size, setSize] = useState(model.equipmentSize ?? "")

  const draft = model.status === "draft" || model.status === "in_review"
  const waiting = model.status === "sent" || model.status === "viewed"
  const toSettle = model.status === "declined" && model.declineOutcome === null
  const readOnly = !draft || pending
  const repairs = model.lines.filter((l) => l.source === "bundle").length
  const first = model.techFirstName
  const statusLine = estimateStatusLine(model)

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

  async function copyLink() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setNotice({ tone: "ok", text: "Link copied. Paste it in a text or email to the property." })
    } catch {
      setNotice({ tone: "ok", text: link })
    }
  }

  const pdf = (
    <a
      href={`/review/estimate/${model.id}/pdf`}
      target="_blank"
      rel="noreferrer"
      className={bigOutline}
    >
      PDF
    </a>
  )

  let actions: React.ReactNode = null
  if (draft && confirming) {
    actions = (
      <div className="flex w-full flex-col gap-2 lg:w-auto lg:items-end">
        <p className="text-[15px] leading-5 font-semibold">
          Send {moneyExact(model.totalCents)} to{" "}
          {model.sendTo.email ?? "(no email on file — you'll get a link to send)"}?
        </p>
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className={bigOutline + " h-14 lg:h-12"}
          >
            Not yet
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(
                () => sendEstimate(model.id, model.updatedAt),
                () => setConfirming(false),
              )
            }
            className={bigPrimary + " h-14 lg:h-12"}
          >
            {pending ? "Sending…" : "Send it"}
          </button>
        </div>
      </div>
    )
  } else if (draft) {
    actions = (
      <button
        type="button"
        disabled={pending}
        onClick={() => setConfirming(true)}
        className={bigPrimary + " flex-1"}
      >
        Send to property
      </button>
    )
  } else if (waiting) {
    actions = (
      <>
        <button
          type="button"
          disabled={pending}
          onClick={() => setAnswer("no")}
          className={bigOutline}
        >
          They said no
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setAnswer("yes")}
          className={bigPrimary}
        >
          They said yes
        </button>
      </>
    )
  } else if (toSettle) {
    actions = (
      <>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => settleDeclined(model.id, false))}
          className={bigOutline}
        >
          Close, no charge
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setNotice(null)
              const r = await settleDeclined(model.id, true)
              if (!r.ok) {
                setNotice({ tone: "error", text: r.message })
                return
              }
              if (r.invoiceId) router.push(`/review/invoice/${r.invoiceId}`)
              else router.refresh()
            })
          }
          className={bigPrimary}
        >
          Bill the diagnostic
        </button>
      </>
    )
  } else if (model.invoiceId) {
    actions = (
      <Link
        href={`/review/invoice/${model.invoiceId}`}
        className={bigPrimary + " flex items-center justify-center"}
      >
        Open the invoice
      </Link>
    )
  } else {
    actions = pdf
  }

  return (
    <div className="flex flex-col gap-4 pb-40 lg:pb-8">
      <Link
        href="/review"
        className="self-start text-[15px] font-semibold text-muted-foreground lg:hidden"
      >
        ← Needs you
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-bold text-muted-foreground">
            {[first === "the tech" ? null : first, model.dateLabel, model.equipmentSize]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <h1 className="mt-1 text-[28px] leading-tight font-extrabold lg:text-[30px]">
            Estimate · {model.propertyName} {model.unitLabel}
          </h1>
          {statusLine ? (
            <p
              className={
                "mt-1 text-[15px] font-bold " +
                (model.status === "declined" ? "text-destructive" : "text-busy-foreground")
              }
            >
              {statusLine}
            </p>
          ) : null}
        </div>
        <div className="hidden gap-2.5 lg:flex">{actions}</div>
      </div>

      {notice ? (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={
            "rounded-xl px-4 py-3 text-[15px] leading-6 font-medium break-words " +
            (notice.tone === "error"
              ? "bg-destructive/10 text-destructive"
              : "bg-busy text-busy-foreground")
          }
        >
          {notice.text}
        </p>
      ) : null}

      {toSettle ? (
        <p className="rounded-xl bg-free px-4 py-3 text-[15px] leading-6 font-semibold text-free-foreground">
          The property declined{model.responseNote ? `: “${model.responseNote}”.` : "."} Bill the
          diagnostic trip (a draft invoice for you to approve) or close the job with no charge.
        </p>
      ) : null}

      {waiting ? (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-card px-4 py-3 text-[15px] leading-6">
          <p>
            Waiting on the property. They can approve or decline on their link, or tell you and you
            mark it here.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={copyLink} className={smallButton + " h-10"}>
              Copy their link
            </button>
            {link ? (
              <a
                href={link}
                target="_blank"
                rel="noreferrer"
                className={smallButton + " flex h-10 items-center"}
              >
                See what they see
              </a>
            ) : null}
            <a
              href={`/review/estimate/${model.id}/pdf`}
              target="_blank"
              rel="noreferrer"
              className={smallButton + " flex h-10 items-center"}
            >
              PDF
            </a>
            {model.emailStatus !== "sent" ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => sendEstimateAgain(model.id))}
                className={smallButton + " h-10"}
              >
                Email it again
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {model.status === "accepted" && !model.invoiceId ? (
        <p className="rounded-xl bg-busy px-4 py-3 text-[15px] leading-6 font-semibold text-busy-foreground">
          {model.board === "parts"
            ? "Approved. The job is in Parts: order the part, then it goes to Ready."
            : "Approved. The job is in Ready. The next visit opens with these repairs at these prices."}
          {model.responseNote ? ` Their note: “${model.responseNote}”` : ""}
        </p>
      ) : null}

      <TimeTiles
        tiles={[
          ["Travel", model.minutes.travel],
          ["Getting in", model.minutes.access],
          ["Work", model.minutes.work],
          ["Total", model.minutes.travel + model.minutes.access + model.minutes.work],
        ]}
      />

      {draft && multiRepairNote(repairs) ? (
        <p className="rounded-xl bg-free px-4 py-3 text-[15px] leading-6 font-semibold text-free-foreground">
          {multiRepairNote(repairs)}
        </p>
      ) : null}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <section className="flex min-w-0 flex-col gap-3 lg:flex-[2]">
          {model.lines.length === 0 ? (
            <p className="rounded-xl border border-border bg-card px-4 py-3 text-[15px] leading-6 text-muted-foreground">
              {first === "the tech" ? "The tech" : first} didn&apos;t pick a repair. Add the lines
              the property should see.
            </p>
          ) : null}
          {model.lines.map((line) => (
            <LineCard
              key={line.id}
              docName="estimate"
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
              onCost={(cost, change) =>
                run(
                  () => setEstimateCostLine(model.id, cost.id, change),
                  () => setEditing(null),
                )
              }
              onSaveLine={(description, amount) =>
                run(
                  () => updateEstimateLine(model.id, line.id, description, amount),
                  () => setEditing(null),
                )
              }
              onRemoveLine={() => run(() => removeEstimateLine(model.id, line.id))}
              onConfirmPart={() => undefined}
              onError={(text) => setNotice({ tone: "error", text })}
            />
          ))}

          {!draft ? null : editing === "new" ? (
            <div className="flex flex-col gap-2 rounded-xl border-2 border-dashed border-muted-foreground bg-card p-3">
              <label className="text-sm font-bold" htmlFor="new-line-text">
                What the property reads
              </label>
              <input
                id="new-line-text"
                className={inputClass}
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                placeholder="e.g. Haul away the old equipment"
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
                placeholder="50"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  className={smallButton + " h-11 flex-1"}
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={pending}
                  className="h-11 flex-1 rounded-lg bg-primary text-[15px] font-bold text-primary-foreground disabled:opacity-60"
                  onClick={() => {
                    const cents = parseDollars(draftAmount)
                    if (cents === null) {
                      setNotice({
                        tone: "error",
                        text: "Type the amount in dollars, like 50 or -25.",
                      })
                      return
                    }
                    run(
                      () => addEstimateLine(model.id, draftText, cents),
                      () => setEditing(null),
                    )
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

          <div className="flex flex-col gap-1 rounded-xl border border-border bg-card px-4 py-3">
            <Row label="Subtotal" value={moneyExact(model.subtotalCents)} />
            <Row
              label={`Sales tax (${ratePercent(model.taxRateBps)})`}
              value={moneyExact(model.taxCents)}
            />
            <div className="mt-1 flex justify-between text-xl font-extrabold">
              <span>Property sees</span>
              <span className="tabular-nums">{moneyExact(model.totalCents)}</span>
            </div>
          </div>
        </section>

        <aside className="flex flex-col gap-3 lg:flex-1">
          {draft && editing === "reason" ? (
            <div className="flex flex-col gap-2 rounded-xl border-2 border-primary bg-card px-4 py-3">
              <label className="text-sm font-bold" htmlFor="est-reason">
                What we found (the property reads this first)
              </label>
              <textarea
                id="est-reason"
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="min-h-28 w-full rounded-lg border border-input bg-card px-3 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
              <label className="text-sm font-bold" htmlFor="est-size">
                Equipment size
              </label>
              <input
                id="est-size"
                className={inputClass}
                value={size}
                onChange={(e) => setSize(e.target.value)}
                placeholder="3 ton"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  className={smallButton + " h-11 flex-1"}
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={pending}
                  className="h-11 flex-1 rounded-lg bg-primary text-[15px] font-bold text-primary-foreground disabled:opacity-60"
                  onClick={() =>
                    run(
                      () => updateEstimateDetails(model.id, reason, size),
                      () => setEditing(null),
                    )
                  }
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            <Panel title="WHAT WE FOUND">
              <p>{model.narrative}</p>
              {model.equipmentSize ? (
                <p className="text-muted-foreground">Equipment: {model.equipmentSize}</p>
              ) : null}
              {draft ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setReason(model.narrative)
                    setSize(model.equipmentSize ?? "")
                    setEditing("reason")
                  }}
                  className="self-start text-[14px] font-semibold text-primary underline-offset-4 hover:underline"
                >
                  Edit
                </button>
              ) : null}
            </Panel>
          )}
          <Panel title="WHAT THE PROPERTY READS">
            {model.lines.map((l) => (
              <p key={l.id}>{l.description}</p>
            ))}
          </Panel>
          {model.note || model.photoCount || model.model ? (
            <Panel title={`FROM ${first.toUpperCase()}`}>
              {model.note ? <p>“{model.note}”</p> : null}
              {model.model || model.serial ? (
                <p>
                  Model {model.model ?? "—"} · Serial {model.serial ?? "—"}
                </p>
              ) : null}
              {model.photoCount ? (
                <p className="text-muted-foreground">
                  {model.photoCount} photo{model.photoCount === 1 ? "" : "s"} on the visit
                </p>
              ) : null}
            </Panel>
          ) : null}
          <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm leading-6 text-muted-foreground">
            {draft ? "Goes to " : "Sent to "}
            {model.sendTo.name ?? "the property"}
            {model.sendTo.email ? ` · ${model.sendTo.email}` : " · no email on file"}
          </p>
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 flex gap-2.5 border-t border-border bg-card px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] lg:hidden">
        {actions}
      </div>

      {answer ? (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-foreground/40 md:items-center"
          onMouseDown={() => setAnswer(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="answer-title"
            className="w-full rounded-t-2xl bg-background px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:max-w-lg md:rounded-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="answer-title" className="text-2xl font-extrabold">
              {answer === "yes" ? "They approved it" : "They declined it"}
            </h2>
            <p className="mt-1 text-[15px] text-muted-foreground">
              {answer === "yes"
                ? repairs > 0
                  ? "If a repair needs a part, the job goes to Parts with an order to place. Otherwise it goes to Ready."
                  : "The job goes to Ready."
                : "Next you pick: bill the diagnostic or close with no charge."}
            </p>
            <label className="mt-3 block text-sm font-bold" htmlFor="answer-note">
              Who said so, and anything they added (optional)
            </label>
            <textarea
              id="answer-note"
              value={answerNote}
              onChange={(e) => setAnswerNote(e.target.value)}
              className="mt-1 min-h-20 w-full rounded-lg border border-input bg-card px-3 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              placeholder="Dana called, go ahead"
            />
            <div className="mt-3 flex gap-2.5">
              <button
                type="button"
                onClick={() => setAnswer(null)}
                className="h-14 flex-1 rounded-[14px] border-2 border-ink bg-card text-[17px] font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(
                    () => recordEstimateAnswer(model.id, answer === "yes", answerNote),
                    () => {
                      setAnswer(null)
                      setAnswerNote("")
                    },
                  )
                }
                className="h-14 flex-[1.3] rounded-[14px] bg-primary text-[18px] font-extrabold text-primary-foreground disabled:opacity-50"
              >
                {pending ? "Saving…" : answer === "yes" ? "Mark approved" : "Mark declined"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
