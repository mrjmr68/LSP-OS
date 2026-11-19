"use client"

import { useState, useTransition } from "react"

import { answerQuestion } from "@/app/actions/question"
import type { TechQuestion } from "@/lib/board-data"

/** An owner's question about one of this tech's drafts, answered right on My jobs. */
export function QuestionCard({ question, onAnswered }: { question: TechQuestion; onAnswered: () => void }) {
  const [answer, setAnswer] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const id = `answer-${question.invoiceId}`
  return (
    <section className="flex flex-col gap-2 rounded-xl border-2 border-primary bg-card px-4 py-3">
      <p className="text-[13px] font-bold tracking-[0.08em] text-primary">QUESTION FROM {question.askedBy.toUpperCase()}</p>
      <p className="text-lg leading-snug font-extrabold">{question.title}</p>
      <p className="text-[16px] leading-6">“{question.question}”</p>
      <label htmlFor={id} className="sr-only">
        Your answer
      </label>
      <textarea
        id={id}
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        placeholder="Your answer"
        className="min-h-20 w-full rounded-lg border border-input bg-background px-3 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={pending || answer.trim() === ""}
        onClick={() =>
          startTransition(async () => {
            setError(null)
            const result = await answerQuestion(question.invoiceId, answer)
            if (!result.ok) {
              setError(result.message)
              return
            }
            onAnswered()
          })
        }
        className="h-14 rounded-[14px] bg-primary text-[18px] font-extrabold text-primary-foreground disabled:opacity-50"
      >
        {pending ? "Sending…" : "Send answer"}
      </button>
    </section>
  )
}
