"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { saveTeamMember } from "@/app/actions/setup"
import { Field, selectClass, type Notice } from "@/components/setup/form-bits"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { SetupTeamMember } from "@/lib/setup-data"
import type { TeamInput } from "@/lib/setup"

export function TeamList({ people }: { people: SetupTeamMember[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {people.map((p) => (
        <PersonCard key={p.id} person={p} />
      ))}
    </div>
  )
}

function PersonCard({ person }: { person: SetupTeamMember }) {
  const router = useRouter()
  const [form, setForm] = useState<TeamInput>({
    fullName: person.fullName,
    phone: person.phone,
    truckLabel: person.truckLabel ?? "",
    role: person.role,
    active: person.active,
  })
  const [notice, setNotice] = useState<Notice>(null)
  const [saving, start] = useTransition()
  const set = <K extends keyof TeamInput>(key: K, value: TeamInput[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
    setNotice(null)
  }
  const changed =
    form.fullName !== person.fullName ||
    form.phone !== person.phone ||
    form.truckLabel !== (person.truckLabel ?? "") ||
    form.role !== person.role ||
    form.active !== person.active
  const id = (s: string) => `${person.id}-${s}`

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        start(async () => {
          const r = await saveTeamMember(person.id, form)
          if (!r.ok) return setNotice({ tone: "error", text: r.message })
          setNotice({ tone: "ok", text: "Saved." })
          router.refresh()
        })
      }}
      className={
        "flex flex-col gap-4 rounded-xl border border-border bg-card p-4 " +
        (person.active ? "" : "opacity-75")
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-2xl leading-tight tracking-wide">
            {person.fullName}
            {person.isMe ? <span className="ml-2 text-sm text-muted-foreground">(you)</span> : null}
          </h2>
          <p className="truncate text-sm text-muted-foreground">{person.email}</p>
        </div>
        <span
          className={
            "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold " +
            (person.active
              ? person.role === "owner"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary"
              : "bg-muted text-muted-foreground")
          }
        >
          {person.active ? (person.role === "owner" ? "Owner" : "Tech") : "Inactive"}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={id("name")} label="Name">
          <Input id={id("name")} value={form.fullName} onChange={(e) => set("fullName", e.target.value)} className="h-11" />
        </Field>
        <Field id={id("phone")} label="Mobile phone">
          <Input id={id("phone")} type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} className="h-11" />
        </Field>
        <Field id={id("truck")} label="Truck">
          <Input id={id("truck")} value={form.truckLabel} onChange={(e) => set("truckLabel", e.target.value)} className="h-11" />
        </Field>
        <Field id={id("role")} label="Role">
          <select
            id={id("role")}
            value={form.role}
            onChange={(e) => set("role", e.target.value)}
            className={selectClass}
          >
            <option value="tech">Tech: My Jobs and the field flow</option>
            <option value="owner">Owner: also Board assigning, review, Setup</option>
          </select>
        </Field>
      </div>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={form.active}
          onChange={(e) => set("active", e.target.checked)}
          className="size-5 accent-primary"
        />
        Can sign in and work jobs
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={saving || !changed}>
          {saving ? "Saving…" : "Save"}
        </Button>
        {notice ? (
          <p
            role={notice.tone === "error" ? "alert" : "status"}
            className={"text-sm font-medium " + (notice.tone === "error" ? "text-destructive" : "text-synced")}
          >
            {notice.text}
          </p>
        ) : null}
      </div>
    </form>
  )
}
