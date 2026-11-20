"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { answerEstimate } from "@/app/actions/estimate-public"

const field =
  "h-12 w-full rounded-lg border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"

/** Approve (with a name) or decline, on the property's estimate link. */
export function EstimateAnswer({ token, total }: { token: string; total: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [mode, setMode] = useState<"approve" | "decline" | null>(null)
  const [name, setName] = useState("")
  const [note, setNote] = useState("")
  const [error, setError] = useState<string | null>(null)

  function submit() {
    setError(null)
    startTransition(async () => {
      const r = await answerEstimate(token, mode === "approve", name, note)
      if (!r.ok) {
        setError(r.message)
        return
      }
      router.refresh()
    })
  }

  if (!mode) {
    return (
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setMode("approve")}
          className="h-14 rounded-[14px] bg-primary text-lg font-extrabold text-primary-foreground"
        >
          Approve {total}
        </button>
        <button
          type="button"
          onClick={() => setMode("decline")}
          className="h-14 rounded-[14px] border-2 border-ink bg-card text-lg font-bold"
        >
          Decline
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border-2 border-primary bg-card p-4">
      <p className="text-lg font-extrabold">
        {mode === "approve" ? `Approve ${total}` : "Decline this estimate"}
      </p>
      {mode === "approve" ? (
        <label className="flex flex-col gap-1 text-sm font-bold">
          Your name
          <input
            className={field}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            autoFocus
          />
        </label>
      ) : null}
      <label className="flex flex-col gap-1 text-sm font-bold">
        {mode === "approve"
          ? "Anything we should know (optional)"
          : "Why, or anything we should know (optional)"}
        <textarea
          className="min-h-20 w-full rounded-lg border border-input bg-card px-3 py-2 text-base font-normal outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-destructive/10 px-3 py-2 text-[15px] text-destructive"
        >
          {error}
        </p>
      ) : null}
      <div className="flex gap-2.5">
        <button
          type="button"
          onClick={() => setMode(null)}
          className="h-12 flex-1 rounded-[12px] border-2 border-ink bg-card text-base font-bold"
        >
          Back
        </button>
        <button
          type="button"
          disabled={pending || (mode === "approve" && name.trim() === "")}
          onClick={submit}
          className="h-12 flex-[1.4] rounded-[12px] bg-primary text-base font-extrabold text-primary-foreground disabled:opacity-50"
        >
          {pending ? "Sending…" : mode === "approve" ? "Approve" : "Decline"}
        </button>
      </div>
    </div>
  )
}
