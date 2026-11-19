"use client"

import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"

export const textareaClass =
  "min-h-20 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
export const selectClass =
  "h-11 w-full rounded-lg border border-input bg-card px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"

export type Notice = { tone: "ok" | "error"; text: string } | null

export function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
      <h2 className="font-display text-xl tracking-wide">{title}</h2>
      {children}
    </section>
  )
}

export function EditorHeader({
  backHref,
  backLabel,
  title,
  retiredNote,
}: {
  backHref: string
  backLabel: string
  title: string
  retiredNote: string | null
}) {
  return (
    <div className="flex flex-wrap items-start gap-3">
      <Link
        href={backHref}
        className="flex min-h-11 items-center rounded-lg border border-border px-3 text-sm lg:hidden"
      >
        ← {backLabel}
      </Link>
      <div className="min-w-0 flex-1">
        <h1 className="font-display text-3xl leading-tight font-semibold tracking-wide">{title}</h1>
        {retiredNote ? (
          <p className="text-sm font-medium text-destructive">{retiredNote}</p>
        ) : null}
      </div>
    </div>
  )
}

export function SaveBar({
  saving,
  saveLabel,
  notice,
  active,
  toggling,
  onToggle,
  retireLabel,
  restoreLabel,
}: {
  saving: boolean
  saveLabel: string
  notice: Notice
  active: boolean | null
  toggling?: boolean
  onToggle?: () => void
  retireLabel?: string
  restoreLabel?: string
}) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
      <Button type="submit" size="field" disabled={saving} className="min-w-32">
        {saving ? "Saving…" : saveLabel}
      </Button>
      {notice ? (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={"text-sm font-medium " + (notice.tone === "error" ? "text-destructive" : "text-synced")}
        >
          {notice.text}
        </p>
      ) : null}
      {active !== null && onToggle ? (
        <Button
          type="button"
          variant={active ? "destructive" : "outline"}
          size="field"
          onClick={onToggle}
          disabled={toggling}
          className="ml-auto"
        >
          {toggling ? "…" : active ? (retireLabel ?? "Retire") : (restoreLabel ?? "Put back in service")}
        </Button>
      ) : null}
    </div>
  )
}

export function EmptyPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="hidden rounded-xl border border-dashed border-border p-8 text-sm leading-6 text-muted-foreground lg:block">
      <h1 className="font-display text-2xl font-semibold tracking-wide text-foreground">{title}</h1>
      <div className="mt-2 max-w-prose">{children}</div>
    </div>
  )
}
