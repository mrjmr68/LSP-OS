"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { updateCountyRate } from "@/app/actions/setup"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatRate } from "@/lib/setup"

type Row = { county: string; rateBps: number; properties: number }

export function TaxRateTable({ rows }: { rows: Row[] }) {
  const [onlyMine, setOnlyMine] = useState(true)
  const [query, setQuery] = useState("")
  const q = query.trim().toLowerCase()
  const shown = rows.filter(
    (r) => (!onlyMine || r.properties > 0) && (!q || r.county.toLowerCase().includes(q)),
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a county"
          aria-label="Find a county"
          className="h-11 max-w-xs text-base"
        />
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onlyMine}
            onChange={(e) => setOnlyMine(e.target.checked)}
            className="size-5 accent-primary"
          />
          Only counties we work in
        </label>
      </div>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {shown.map((r) => (
          <RateRow key={r.county} row={r} />
        ))}
        {shown.length === 0 ? (
          <li className="px-4 py-6 text-sm text-muted-foreground">No counties match.</li>
        ) : null}
      </ul>
    </div>
  )
}

function RateRow({ row }: { row: Row }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState((row.rateBps / 100).toString())
  const [message, setMessage] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function save() {
    start(async () => {
      const result = await updateCountyRate(row.county, value)
      if (!result.ok) {
        setMessage(result.message)
        return
      }
      setMessage(null)
      setEditing(false)
      router.refresh()
    })
  }

  return (
    <li className="flex min-h-14 flex-wrap items-center gap-3 px-4 py-2">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{row.county}</p>
        <p className="text-sm text-muted-foreground">
          {row.properties === 0
            ? "No active properties"
            : `${row.properties} active propert${row.properties === 1 ? "y" : "ies"}`}
        </p>
      </div>
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
          className="flex items-center gap-2"
        >
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode="decimal"
            aria-label={`${row.county} rate in percent`}
            className="h-10 w-20 text-right tabular-nums"
            autoFocus
          />
          <span className="text-sm">%</span>
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? "…" : "Save"}
          </Button>
          <Button type="button" variant="ghost" size="lg" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="flex min-h-11 items-center gap-2 rounded-lg px-3 font-display text-2xl tabular-nums hover:bg-muted"
          aria-label={`Change ${row.county} rate, now ${formatRate(row.rateBps)}`}
        >
          {formatRate(row.rateBps)}
        </button>
      )}
      {message ? (
        <p role="alert" className="w-full text-sm text-destructive">
          {message}
        </p>
      ) : null}
    </li>
  )
}
