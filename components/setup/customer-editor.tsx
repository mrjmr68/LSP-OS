"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { createCustomer, saveCustomer, setCustomerActive } from "@/app/actions/setup"
import {
  EditorHeader,
  Field,
  SaveBar,
  Section,
  selectClass,
  textareaClass,
  type Notice,
} from "@/components/setup/form-bits"
import { Input } from "@/components/ui/input"
import type { SetupCustomerFull } from "@/lib/setup-data"
import {
  ADDON_MODES,
  RESIDENT_MODES,
  SIGNOFF_MODES,
  centsToDollars,
  type CustomerInput,
} from "@/lib/setup"

export type ContactOption = { id: string; name: string; title: string | null; active: boolean }

export function CustomerEditor({
  customer,
  contacts,
}: {
  customer: SetupCustomerFull
  contacts: ContactOption[]
}) {
  const router = useRouter()
  const [form, setForm] = useState<CustomerInput>({
    name: customer.name,
    billingContactId: customer.billingContactId,
    billingEmailOverride: customer.billingEmailOverride ?? "",
    paymentTermsDays: String(customer.paymentTermsDays),
    siteAccessText: customer.siteAccessText ?? "",
    addonApprovalMode: customer.addonApprovalMode,
    addonApprovalLimit: centsToDollars(customer.addonApprovalLimitCents),
    addonApprovalNotes: customer.addonApprovalNotes ?? "",
    signoffRequirement: customer.signoffRequirement,
    signoffNotes: customer.signoffNotes ?? "",
    residentReportMode: customer.residentReportMode,
    residentReportNotes: customer.residentReportNotes ?? "",
    requiresEstimateOver: centsToDollars(customer.requiresEstimateOverCents),
  })
  const [notice, setNotice] = useState<Notice>(null)
  const [saving, startSave] = useTransition()
  const [toggling, startToggle] = useTransition()
  const set = (key: keyof CustomerInput) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value }))
    setNotice(null)
  }
  const billingChoices = contacts.filter((c) => c.active || c.id === form.billingContactId)

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        startSave(async () => {
          const r = await saveCustomer(customer.id, form)
          if (!r.ok) return setNotice({ tone: "error", text: r.message })
          setNotice({ tone: "ok", text: "Saved." })
          router.refresh()
        })
      }}
      className="flex flex-col gap-5"
    >
      <EditorHeader
        backHref="/setup/customers"
        backLabel="All customers"
        title={customer.name}
        retiredNote={customer.active ? null : "Retired."}
      />
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Section title="Billing">
          <Field id="name" label="Customer name" hint="As it should appear on invoices.">
            <Input id="name" value={form.name} onChange={(e) => set("name")(e.target.value)} className="h-11" required />
          </Field>
          <Field id="billing" label="Billing contact">
            <select id="billing" value={form.billingContactId} onChange={(e) => set("billingContactId")(e.target.value)} className={selectClass}>
              {billingChoices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.title ? ` · ${c.title}` : ""}
                  {c.active ? "" : " (retired)"}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <Field id="billingEmail" label="Send invoices to (optional)" hint="Leave blank to use the billing contact's email.">
              <Input id="billingEmail" type="email" value={form.billingEmailOverride} onChange={(e) => set("billingEmailOverride")(e.target.value)} className="h-11" />
            </Field>
            <Field id="terms" label="Terms (days)">
              <Input id="terms" inputMode="numeric" value={form.paymentTermsDays} onChange={(e) => set("paymentTermsDays")(e.target.value)} className="h-11 tabular-nums" />
            </Field>
          </div>
        </Section>

        <Section title="House rules">
          <p className="-mt-2 text-sm text-muted-foreground">
            The default for every property of this customer. Techs see these on the job.
          </p>
          <Field id="addon" label="Extra repairs found on site">
            <select id="addon" value={form.addonApprovalMode} onChange={(e) => set("addonApprovalMode")(e.target.value)} className={selectClass}>
              {ADDON_MODES.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </Field>
          {form.addonApprovalMode === "do_under_limit" ? (
            <Field id="addonLimit" label="Go ahead up to ($)">
              <Input id="addonLimit" inputMode="decimal" value={form.addonApprovalLimit} onChange={(e) => set("addonApprovalLimit")(e.target.value)} className="h-11 w-40 tabular-nums" />
            </Field>
          ) : null}
          <Field id="addonNotes" label="Notes on extra repairs">
            <textarea id="addonNotes" value={form.addonApprovalNotes} onChange={(e) => set("addonApprovalNotes")(e.target.value)} className={textareaClass} />
          </Field>
          <Field id="estimateOver" label="Estimate required over ($, optional)">
            <Input id="estimateOver" inputMode="decimal" value={form.requiresEstimateOver} onChange={(e) => set("requiresEstimateOver")(e.target.value)} className="h-11 w-40 tabular-nums" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="signoff" label="Sign-off when done">
              <select id="signoff" value={form.signoffRequirement} onChange={(e) => set("signoffRequirement")(e.target.value)} className={selectClass}>
                {SIGNOFF_MODES.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </Field>
            <Field id="resident" label="Calls from residents">
              <select id="resident" value={form.residentReportMode} onChange={(e) => set("residentReportMode")(e.target.value)} className={selectClass}>
                {RESIDENT_MODES.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field id="signoffNotes" label="Sign-off notes">
            <textarea id="signoffNotes" value={form.signoffNotes} onChange={(e) => set("signoffNotes")(e.target.value)} className={textareaClass} />
          </Field>
          <Field id="residentNotes" label="Resident call notes">
            <textarea id="residentNotes" value={form.residentReportNotes} onChange={(e) => set("residentReportNotes")(e.target.value)} className={textareaClass} />
          </Field>
        </Section>

        <Section title="Getting in (all properties)">
          <Field id="access" label="Access notes that apply to every property" hint="Each property can add its own on the Properties screen.">
            <textarea id="access" value={form.siteAccessText} onChange={(e) => set("siteAccessText")(e.target.value)} className={textareaClass} />
          </Field>
        </Section>
      </div>
      <SaveBar
        saving={saving}
        saveLabel="Save"
        notice={notice}
        active={customer.active}
        toggling={toggling}
        retireLabel="Retire customer"
        onToggle={() =>
          startToggle(async () => {
            const r = await setCustomerActive(customer.id, !customer.active)
            if (!r.ok) return setNotice({ tone: "error", text: r.message })
            setNotice({ tone: "ok", text: customer.active ? "Retired." : "Back in service." })
            router.refresh()
          })
        }
      />
    </form>
  )
}

export function NewCustomerForm() {
  const router = useRouter()
  const [form, setForm] = useState({
    name: "",
    paymentTermsDays: "30",
    contactName: "",
    contactTitle: "",
    contactPhone: "",
    contactEmail: "",
  })
  const [notice, setNotice] = useState<Notice>(null)
  const [saving, startSave] = useTransition()
  const set = (key: keyof typeof form) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value }))
    setNotice(null)
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        startSave(async () => {
          const r = await createCustomer(form)
          if (!r.ok) return setNotice({ tone: "error", text: r.message })
          router.push(`/setup/customers/${r.value.id}`)
        })
      }}
      className="flex flex-col gap-5"
    >
      <EditorHeader backHref="/setup/customers" backLabel="All customers" title="New customer" retiredNote={null} />
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Section title="Customer">
          <Field id="name" label="Customer name" hint="The management company, or the person for a one-off job.">
            <Input id="name" value={form.name} onChange={(e) => set("name")(e.target.value)} className="h-11" required />
          </Field>
          <Field id="terms" label="Payment terms (days)">
            <Input id="terms" inputMode="numeric" value={form.paymentTermsDays} onChange={(e) => set("paymentTermsDays")(e.target.value)} className="h-11 w-32 tabular-nums" />
          </Field>
        </Section>
        <Section title="Billing contact">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="cname" label="Name">
              <Input id="cname" value={form.contactName} onChange={(e) => set("contactName")(e.target.value)} className="h-11" required />
            </Field>
            <Field id="ctitle" label="Title">
              <Input id="ctitle" value={form.contactTitle} onChange={(e) => set("contactTitle")(e.target.value)} className="h-11" />
            </Field>
            <Field id="cphone" label="Phone">
              <Input id="cphone" type="tel" value={form.contactPhone} onChange={(e) => set("contactPhone")(e.target.value)} className="h-11" />
            </Field>
            <Field id="cemail" label="Email">
              <Input id="cemail" type="email" value={form.contactEmail} onChange={(e) => set("contactEmail")(e.target.value)} className="h-11" />
            </Field>
          </div>
        </Section>
      </div>
      <p className="text-sm text-muted-foreground">
        Rules start as &quot;call first&quot; and &quot;confirm with the property&quot;. Change them after adding.
      </p>
      <SaveBar saving={saving} saveLabel="Add customer" notice={notice} active={null} />
    </form>
  )
}
