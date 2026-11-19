"use client"

import Link from "next/link"
import { useState } from "react"

import { Input } from "@/components/ui/input"

export type RecordItem = {
  id: string
  title: string
  subtitle: string
  active: boolean
  /** Extra words the search should match (phone, email, customer). */
  searchText?: string
}

type Filter = "active" | "retired" | "all"

/** Search + Active/Retired/All list used by every Setup section but Properties. */
export function RecordList({
  items,
  selectedId,
  basePath,
  addLabel,
  searchLabel,
  limit = 150,
}: {
  items: RecordItem[]
  selectedId: string | null
  basePath: string
  addLabel: string | null
  searchLabel: string
  limit?: number
}) {
  const [filter, setFilter] = useState<Filter>("active")
  const [query, setQuery] = useState("")
  const q = query.trim().toLowerCase()

  const counts = {
    active: items.filter((i) => i.active).length,
    retired: items.filter((i) => !i.active).length,
    all: items.length,
  }
  const matching = items.filter((i) => {
    if (filter === "active" && !i.active) return false
    if (filter === "retired" && i.active) return false
    if (!q) return true
    return `${i.title} ${i.subtitle} ${i.searchText ?? ""}`.toLowerCase().includes(q)
  })
  const shown = matching.slice(0, limit)

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchLabel}
          aria-label={searchLabel}
          className="h-11 text-base"
        />
        {addLabel ? (
          <Link
            href={`${basePath}/new`}
            className="flex h-11 shrink-0 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/80"
          >
            {addLabel}
          </Link>
        ) : null}
      </div>
      <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
        {(["active", "retired", "all"] as const).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={
              "flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm capitalize " +
              (filter === f
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card hover:bg-muted")
            }
          >
            {f}
            <span className="tabular-nums opacity-80">{counts[f]}</span>
          </button>
        ))}
      </div>
      <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {shown.length === 0 ? (
          <li className="px-4 py-6 text-sm text-muted-foreground">Nothing matches.</li>
        ) : (
          shown.map((i) => {
            const selected = i.id === selectedId
            return (
              <li key={i.id}>
                <Link
                  href={`${basePath}/${i.id}`}
                  aria-current={selected ? "true" : undefined}
                  className={
                    "flex min-h-14 flex-col justify-center px-4 py-2.5 " +
                    (selected ? "bg-secondary" : "hover:bg-muted")
                  }
                >
                  <span className="truncate font-medium">
                    {i.title}
                    {!i.active ? (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">retired</span>
                    ) : null}
                  </span>
                  <span className="truncate text-sm text-muted-foreground">{i.subtitle}</span>
                </Link>
              </li>
            )
          })
        )}
      </ul>
      {matching.length > shown.length ? (
        <p className="text-sm text-muted-foreground">
          Showing {shown.length} of {matching.length}. Search to narrow it down.
        </p>
      ) : null}
    </div>
  )
}
