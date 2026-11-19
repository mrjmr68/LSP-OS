"use client"

import Link from "next/link"
import { useMemo, useState } from "react"

import { Input } from "@/components/ui/input"
import { formatRate, matchesProperty, type PropertyFilter } from "@/lib/setup"

export type PropertyListItem = {
  id: string
  name: string
  addressLine1: string
  city: string
  county: string | null
  taxRateBps: number
  lat: number | null
  active: boolean
}

const FILTERS: { id: PropertyFilter; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "needs-pin", label: "Needs pin" },
  { id: "retired", label: "Retired" },
  { id: "all", label: "All" },
]

export function PropertyList({
  items,
  selectedId,
}: {
  items: PropertyListItem[]
  selectedId: string | null
}) {
  const [filter, setFilter] = useState<PropertyFilter>("active")
  const [query, setQuery] = useState("")

  const counts = useMemo(() => {
    const c: Record<PropertyFilter, number> = { active: 0, "needs-pin": 0, retired: 0, all: 0 }
    for (const p of items) {
      for (const f of FILTERS) if (matchesProperty(p, f.id, "")) c[f.id] += 1
    }
    return c
  }, [items])

  const shown = items.filter((p) => matchesProperty(p, filter, query))

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, city, county"
          aria-label="Search properties"
          className="h-11 text-base"
        />
        <Link
          href="/setup/properties/new"
          className="flex h-11 shrink-0 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/80"
        >
          Add
        </Link>
      </div>

      <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={
              "flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm " +
              (filter === f.id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card hover:bg-muted") +
              (f.id === "needs-pin" && counts["needs-pin"] > 0 && filter !== f.id
                ? " border-high"
                : "")
            }
          >
            {f.label}
            <span className="tabular-nums opacity-80">{counts[f.id]}</span>
          </button>
        ))}
      </div>

      <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {shown.length === 0 ? (
          <li className="px-4 py-6 text-sm text-muted-foreground">No properties match.</li>
        ) : (
          shown.map((p) => {
            const selected = p.id === selectedId
            return (
              <li key={p.id}>
                <Link
                  href={`/setup/properties/${p.id}`}
                  aria-current={selected ? "true" : undefined}
                  className={
                    "flex min-h-14 items-center gap-3 px-4 py-2.5 " +
                    (selected ? "bg-secondary" : "hover:bg-muted")
                  }
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {p.name}
                      {!p.active ? (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          retired
                        </span>
                      ) : null}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      {p.city}
                      {p.county ? ` · ${p.county} ${formatRate(p.taxRateBps)}` : " · no county"}
                    </p>
                  </div>
                  {p.active && p.lat === null ? (
                    <span className="shrink-0 rounded-full bg-high px-2 py-0.5 text-xs font-bold text-high-foreground">
                      No pin
                    </span>
                  ) : null}
                </Link>
              </li>
            )
          })
        )}
      </ul>
    </div>
  )
}
