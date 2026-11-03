"use client"

import { useState } from "react"

import { submitFeedback } from "@/app/actions/feedback"
import { Sheet } from "@/components/board/sheet"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  FEEDBACK_KINDS,
  feedbackContextSummary,
  feedbackDraftError,
  type FeedbackContextInput,
  type FeedbackKind,
} from "@/lib/feedback"

export function FeedbackSheet({
  open,
  context,
  onClose,
  onSaved,
}: {
  open: boolean
  context: FeedbackContextInput
  onClose: () => void
  onSaved: (message: string) => void
}) {
  if (!open) {
    return null
  }
  return <FeedbackForm context={context} onClose={onClose} onSaved={onSaved} />
}

function FeedbackForm({
  context,
  onClose,
  onSaved,
}: {
  context: FeedbackContextInput
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [kind, setKind] = useState<FeedbackKind | null>(null)
  const [body, setBody] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const summary = feedbackContextSummary(context)
  const draftError = feedbackDraftError(kind, body)

  async function send() {
    const problem = feedbackDraftError(kind, body)
    if (problem || !kind) {
      setError(problem ?? "Pick a type.")
      return
    }
    setSaving(true)
    setError(null)
    const result = await submitFeedback({
      kind,
      body,
      context,
    })
    setSaving(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    onSaved("Saved.")
  }

  return (
    <Sheet open title="Report / suggest" onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          void send()
        }}
      >
        <p className="text-sm leading-6">
          A bug, something you noticed, or a change you want. Owners can read it later.
        </p>
        <div role="group" aria-label="Type" className="flex flex-col gap-2">
          {FEEDBACK_KINDS.map((item) => (
            <Button
              key={item.kind}
              type="button"
              size="field"
              variant={kind === item.kind ? "default" : "outline"}
              aria-pressed={kind === item.kind}
              onClick={() => setKind(item.kind)}
            >
              {item.label}
            </Button>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="feedback-body">What should we know?</Label>
          <textarea
            id="feedback-body"
            value={body}
            required
            rows={5}
            aria-invalid={error !== null}
            className="min-h-32 rounded-lg border border-input bg-transparent px-3 py-2 text-base leading-6"
            onChange={(event) => setBody(event.target.value)}
          />
        </div>
        <p className="text-xs leading-5 text-muted-foreground">We&apos;ll include: {summary}</p>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" size="field" disabled={saving || draftError !== null}>
          {saving ? "Sending…" : "Send"}
        </Button>
      </form>
    </Sheet>
  )
}
