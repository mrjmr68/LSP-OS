"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { saveContact, setContactActive } from "@/app/actions/setup"
import {
  EditorHeader,
  Field,
  SaveBar,
  Section,
  selectClass,
  type Notice,
} from "@/components/setup/form-bits"
import { Input } from "@/components/ui/input"
import type { SetupContact, SetupCustomer } from "@/lib/setup-data"
import type { ContactInput } from "@/lib/setup"

export type PropertyOption = { id: string; name: string; city: string; customerId: string; active: boolean }

export function ContactEditor({
  contact,
  customers,
  properties,
  isBillingContact,
}: {
  contact: SetupContact | null
  customers: SetupCustomer[]
  properties: PropertyOption[]
  isBillingContact: boolean
}) {
  const router = useRouter()
  const [form, setForm] = useState<ContactInput>({
    customerId: contact?.customerId ?? customers.find((c) => c.active)?.id ?? "",
    name: contact?.name ?? "",
    title: contact?.title ?? "",
    phone: contact?.phone ?? "",
    email: contact?.email ?? "",
    smsOk: contact?.smsOk ?? true,
    propertyIds: contact?.propertyIds ?? [],
  })
  const [propertyQuery, setPropertyQuery] = useState("")
  const [notice, setNotice] = useState<Notice>(null)
  const [saving, startSave] = useTransition()
  const [toggling, startToggle] = useTransition()

  const set = <K extends keyof ContactInput>(key: K, value: ContactInput[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
    setNotice(null)
  }

  const linked = new Set(form.propertyIds)
  const q = propertyQuery.trim().toLowerCase()
  const options = properties
    .filter((p) => p.customerId === form.customerId && (p.active || linked.has(p.id)))
    .filter((p) => !q || `${p.name} ${p.city}`.toLowerCase().includes(q))

  function toggleProperty(id: string) {
    set(
      "propertyIds",
      linked.has(id) ? form.propertyIds.filter((p) => p !== id) : [...form.propertyIds, id],
    )
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        startSave(async () => {
          const r = await saveContact(contact?.id ?? null, form)
          if (!r.ok) return setNotice({ tone: "error", text: r.message })
          setNotice({ tone: "ok", text: "Saved." })
          if (!contact) router.push(`/setup/contacts/${r.value.id}`)
          else router.refresh()
        })
      }}
      className="flex flex-col gap-5"
    >
      <EditorHeader
        backHref="/setup/contacts"
        backLabel="All contacts"
        title={contact ? contact.name : "New contact"}
        retiredNote={
          contact && !contact.active
            ? "Retired. Not offered in Quick Add and gets no texts."
            : null
        }
      />
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Section title="Contact">
          <Field id="customer" label="Works for">
            <select
              id="customer"
              value={form.customerId}
              onChange={(e) => {
                setForm((f) => ({ ...f, customerId: e.target.value, propertyIds: [] }))
                setNotice(null)
              }}
              disabled={contact !== null}
              className={selectClass}
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.active ? "" : " (retired)"}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="name" label="Name">
              <Input id="name" value={form.name} onChange={(e) => set("name", e.target.value)} className="h-11" required />
            </Field>
            <Field id="title" label="Title" hint="e.g. Property manager, Maintenance">
              <Input id="title" value={form.title} onChange={(e) => set("title", e.target.value)} className="h-11" />
            </Field>
            <Field id="phone" label="Mobile phone">
              <Input id="phone" type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} className="h-11" />
            </Field>
            <Field id="email" label="Email">
              <Input id="email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} className="h-11" />
            </Field>
          </div>
          <label className="flex min-h-11 items-start gap-3 text-sm leading-6">
            <input
              type="checkbox"
              checked={form.smsOk}
              onChange={(e) => set("smsOk", e.target.checked)}
              className="mt-1 size-5 shrink-0 accent-primary"
            />
            <span>
              OK to text this person job updates (on the way, done, estimate ready).
              Uncheck if they asked not to be texted.
            </span>
          </label>
          {isBillingContact ? (
            <p className="rounded-lg bg-secondary px-3 py-2 text-sm">
              Billing contact for this customer. Invoices go to them.
            </p>
          ) : null}
        </Section>

        <Section title={`Properties (${form.propertyIds.length})`}>
          <p className="-mt-2 text-sm text-muted-foreground">
            The properties this person handles. Quick Add offers them as the contact there.
          </p>
          <Input
            type="search"
            value={propertyQuery}
            onChange={(e) => setPropertyQuery(e.target.value)}
            placeholder="Find a property"
            aria-label="Find a property"
            className="h-10"
          />
          <ul className="max-h-96 divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {options.length === 0 ? (
              <li className="px-3 py-4 text-sm text-muted-foreground">No properties match.</li>
            ) : (
              options.map((p) => (
                <li key={p.id}>
                  <label className="flex min-h-11 items-center gap-3 px-3 py-2 text-sm hover:bg-muted">
                    <input
                      type="checkbox"
                      checked={linked.has(p.id)}
                      onChange={() => toggleProperty(p.id)}
                      className="size-5 shrink-0 accent-primary"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {p.name}
                      <span className="text-muted-foreground"> · {p.city}</span>
                      {!p.active ? <span className="text-muted-foreground"> · retired</span> : null}
                    </span>
                  </label>
                </li>
              ))
            )}
          </ul>
        </Section>
      </div>
      <SaveBar
        saving={saving}
        saveLabel={contact ? "Save" : "Add contact"}
        notice={notice}
        active={contact ? contact.active : null}
        toggling={toggling}
        retireLabel="Retire contact"
        onToggle={() =>
          contact &&
          startToggle(async () => {
            const r = await setContactActive(contact.id, !contact.active)
            if (!r.ok) return setNotice({ tone: "error", text: r.message })
            setNotice({ tone: "ok", text: contact.active ? "Retired." : "Back in service." })
            router.refresh()
          })
        }
      />
    </form>
  )
}
