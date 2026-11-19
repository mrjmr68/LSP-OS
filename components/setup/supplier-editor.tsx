"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { saveSupplier, setSupplierActive } from "@/app/actions/setup"
import {
  EditorHeader,
  Field,
  SaveBar,
  Section,
  textareaClass,
  type Notice,
} from "@/components/setup/form-bits"
import { Input } from "@/components/ui/input"
import type { SetupSupplier } from "@/lib/setup-data"
import type { SupplierInput } from "@/lib/setup"

export function SupplierEditor({ supplier }: { supplier: SetupSupplier | null }) {
  const router = useRouter()
  const [form, setForm] = useState<SupplierInput>({
    name: supplier?.name ?? "",
    branch: supplier?.branch ?? "",
    phone: supplier?.phone ?? "",
    email: supplier?.email ?? "",
    notes: supplier?.notes ?? "",
  })
  const [notice, setNotice] = useState<Notice>(null)
  const [saving, startSave] = useTransition()
  const [toggling, startToggle] = useTransition()
  const set = (key: keyof SupplierInput) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value }))
    setNotice(null)
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        startSave(async () => {
          const r = await saveSupplier(supplier?.id ?? null, form)
          if (!r.ok) return setNotice({ tone: "error", text: r.message })
          setNotice({ tone: "ok", text: "Saved." })
          if (!supplier) router.push(`/setup/suppliers/${r.value.id}`)
          else router.refresh()
        })
      }}
      className="flex flex-col gap-5"
    >
      <EditorHeader
        backHref="/setup/suppliers"
        backLabel="All suppliers"
        title={supplier ? supplier.name : "New supplier"}
        retiredNote={
          supplier && !supplier.active ? "Retired. Techs don't see it when ordering parts." : null
        }
      />
      <Section title="Supplier">
        <div className="grid gap-4 md:grid-cols-2">
          <Field id="name" label="Name">
            <Input id="name" value={form.name} onChange={(e) => set("name")(e.target.value)} className="h-11" required />
          </Field>
          <Field id="branch" label="Branch" hint="e.g. Greensboro, Wendover Ave">
            <Input id="branch" value={form.branch} onChange={(e) => set("branch")(e.target.value)} className="h-11" />
          </Field>
          <Field id="phone" label="Phone" hint="Techs tap this to call from the parts screen.">
            <Input id="phone" type="tel" value={form.phone} onChange={(e) => set("phone")(e.target.value)} className="h-11" />
          </Field>
          <Field id="email" label="Email">
            <Input id="email" type="email" value={form.email} onChange={(e) => set("email")(e.target.value)} className="h-11" />
          </Field>
        </div>
        <Field id="notes" label="Notes" hint="Account number, counter hours, who to ask for.">
          <textarea id="notes" value={form.notes} onChange={(e) => set("notes")(e.target.value)} className={textareaClass} />
        </Field>
      </Section>
      <SaveBar
        saving={saving}
        saveLabel={supplier ? "Save" : "Add supplier"}
        notice={notice}
        active={supplier ? supplier.active : null}
        toggling={toggling}
        retireLabel="Retire supplier"
        onToggle={() =>
          supplier &&
          startToggle(async () => {
            const r = await setSupplierActive(supplier.id, !supplier.active)
            if (!r.ok) return setNotice({ tone: "error", text: r.message })
            setNotice({ tone: "ok", text: supplier.active ? "Retired." : "Back in service." })
            router.refresh()
          })
        }
      />
    </form>
  )
}
