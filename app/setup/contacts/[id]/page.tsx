import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { ContactEditor } from "@/components/setup/contact-editor"
import { contactItems } from "@/components/setup/items"
import { RecordList } from "@/components/setup/record-list"
import { isUuid } from "@/lib/setup"
import {
  loadContacts,
  loadCustomers,
  loadCustomersFull,
  loadSetupProperties,
  requireOwner,
} from "@/lib/setup-data"

export const metadata: Metadata = { title: "Contact" }

export default async function SetupContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const isNew = id === "new"
  if (!isNew && !isUuid(id)) notFound()
  const supabase = await requireOwner()
  const [contacts, customers, customersFull, properties] = await Promise.all([
    loadContacts(supabase),
    loadCustomers(supabase),
    loadCustomersFull(supabase),
    loadSetupProperties(supabase),
  ])
  const contact = isNew ? null : (contacts.find((c) => c.id === id) ?? null)
  if (!isNew && !contact) notFound()
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(20rem,26rem)_1fr]">
      <div className="hidden lg:block">
        <RecordList
          items={contactItems(contacts)}
          selectedId={isNew ? null : id}
          basePath="/setup/contacts"
          addLabel="Add"
          searchLabel="Search name, phone, email"
        />
      </div>
      <ContactEditor
        key={id}
        contact={contact}
        customers={customers}
        properties={properties.map((p) => ({
          id: p.id,
          name: p.name,
          city: p.city,
          customerId: p.customerId,
          active: p.active,
        }))}
        isBillingContact={customersFull.some((c) => c.billingContactId === id)}
      />
    </div>
  )
}
