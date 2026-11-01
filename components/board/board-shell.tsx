"use client"

import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  BOARD_CATEGORIES,
  type BoardCard,
  type BoardViewer,
  initials,
} from "@/lib/board"

type Filter = "all" | "mine"

export function BoardShell({
  viewer,
  cards,
  profileMissing,
  loadError,
}: {
  viewer: BoardViewer
  cards: BoardCard[]
  profileMissing: boolean
  loadError: string | null
}) {
  const [filter, setFilter] = useState<Filter>("all")
  const visible = cards.filter((card) =>
    filter === "all" ? true : card.assignedUserId === viewer.profileId,
  )
  const openCount = visible.length

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="font-display text-2xl leading-none font-bold tracking-wide text-foreground">
              LSP
            </p>
            <p className="text-xs text-muted-foreground">Legend Service Pros</p>
          </div>
          <p className="hidden text-sm font-medium text-muted-foreground sm:block">
            Board
          </p>
          <div className="ml-auto flex items-center gap-2">
            <SyncPill mode={viewer.mode} hasError={Boolean(loadError)} />
            <AccountMenu viewer={viewer} />
          </div>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-4 px-4 py-4">
        {viewer.mode === "preview" ? (
          <p className="rounded-lg border border-border bg-card px-4 py-3 text-sm leading-6">
            Supabase is not connected, so this is the empty Board. Sign-in
            starts after the project URL and anon key are in{" "}
            <span className="font-medium">.env.local</span>.
          </p>
        ) : null}

        {profileMissing ? (
          <p className="rounded-lg border border-border bg-card px-4 py-3 text-sm leading-6">
            This login is not on the crew list yet. Adding the user in
            Supabase should create a profile. An owner sets the role to owner
            or tech.
          </p>
        ) : null}

        {loadError ? (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm leading-6 text-destructive">
            {loadError}
          </p>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div
            role="group"
            aria-label="Board filter"
            className="grid grid-cols-2 gap-2 sm:flex"
          >
            <Button
              type="button"
              size="field"
              variant={filter === "all" ? "default" : "outline"}
              aria-pressed={filter === "all"}
              onClick={() => setFilter("all")}
            >
              All jobs
            </Button>
            <Button
              type="button"
              size="field"
              variant={filter === "mine" ? "default" : "outline"}
              aria-pressed={filter === "mine"}
              onClick={() => setFilter("mine")}
            >
              My jobs
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            {openCount === 0
              ? filter === "mine"
                ? "Nothing assigned to you — check with an owner."
                : "No open calls."
              : `${openCount} open ${openCount === 1 ? "call" : "calls"}`}
          </p>
        </div>

        <div className="flex gap-3 overflow-x-auto pb-6 max-md:flex-col md:snap-x">
          {BOARD_CATEGORIES.map((category) => {
            const column = visible.filter((card) => card.status === category.status)
            return (
              <section
                key={category.status}
                aria-label={category.label}
                className="rounded-xl border border-border bg-card md:w-72 md:shrink-0 md:snap-start"
              >
                <header className="flex min-h-12 items-end justify-between gap-3 border-b border-border px-3 py-2">
                  <div>
                    <h2 className="font-display text-xl leading-none font-semibold tracking-wide uppercase">
                      {category.label}
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">{category.hint}</p>
                  </div>
                  <p className="font-display text-3xl leading-none tabular-nums">
                    {column.length}
                  </p>
                </header>
                <div className="flex flex-col gap-2 p-2">
                  {column.length === 0 ? (
                    <p className="px-2 py-4 text-sm text-muted-foreground">No calls</p>
                  ) : (
                    column.map((card) => <CallCard key={card.id} card={card} />)
                  )}
                </div>
              </section>
            )
          })}
        </div>
      </main>
    </div>
  )
}

function CallCard({ card }: { card: BoardCard }) {
  const high = card.priority === "high"
  return (
    <article
      className={
        high
          ? "rounded-lg border border-high/50 bg-high/15 px-3 py-3"
          : "rounded-lg border border-border bg-background px-3 py-3"
      }
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-display text-lg leading-none tracking-wide">
          {card.displayNumber}
        </p>
        <div className="flex items-center gap-1">
          {high ? (
            <Badge className="bg-high text-high-foreground">High</Badge>
          ) : null}
          <span className="text-xs text-muted-foreground tabular-nums">
            {card.ageLabel}
          </span>
        </div>
      </div>
      <p className="mt-2 text-sm font-medium">
        {card.propertyName} · {card.unitLabel}
      </p>
      <p className="mt-1 text-sm leading-5">{card.issue}</p>
      <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{card.sourceLabel}</span>
        <span className="inline-flex min-h-6 items-center gap-1">
          <span
            aria-hidden
            className="inline-flex size-6 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground"
          >
            {card.assigneeName ? initials(card.assigneeName) : "—"}
          </span>
          {card.assigneeName ?? "Unassigned"}
        </span>
      </div>
    </article>
  )
}

function SyncPill({
  mode,
  hasError,
}: {
  mode: BoardViewer["mode"]
  hasError: boolean
}) {
  const label = hasError ? "Not loaded" : mode === "preview" ? "Preview" : "Synced"
  const dot = hasError
    ? "bg-destructive"
    : mode === "preview"
      ? "bg-muted-foreground"
      : "bg-synced"
  return (
    <span className="inline-flex min-h-12 items-center gap-2 rounded-full border border-border px-3 text-sm">
      <span aria-hidden className={`size-2.5 rounded-full ${dot}`} />
      {label}
    </span>
  )
}

function AccountMenu({ viewer }: { viewer: BoardViewer }) {
  const roleLabel =
    viewer.role === "owner" ? "Owner" : viewer.role === "tech" ? "Tech" : "No role"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="field" className="min-w-12 px-3" />
        }
      >
        {initials(viewer.fullName)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="text-sm text-foreground">
          {viewer.fullName}
        </DropdownMenuLabel>
        <DropdownMenuItem disabled className="min-h-12">
          {roleLabel}
        </DropdownMenuItem>
        {viewer.mode === "authenticated" ? (
          <>
            <DropdownMenuSeparator />
            <form action="/auth/signout" method="post">
              <DropdownMenuItem
                render={<button type="submit" className="w-full text-left" />}
                className="min-h-12"
              >
                Sign out
              </DropdownMenuItem>
            </form>
          </>
        ) : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<a href="/login" />} className="min-h-12">
              Setup sign-in
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
