import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { CustomerEditor, NewCustomerForm } from "@/components/setup/customer-editor"
import { customerItems } from "@/components/setup/items"
import { RecordList } from "@/components/setup/record-list"
import { isUuid } from "@/lib/setup"
import { loadContacts, loadCustomersFull, requireOwner } from "@/lib/setup-data"

export const metadata: Metadata = { title: "Customer" }

export default async function SetupCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const isNew = id === "new"
  if (!isNew && !isUuid(id)) notFound()
  const supabase = await requireOwner()
  const [customers, contacts] = await Promise.all([loadCustomersFull(supabase), loadContacts(supabase)])
  const customer = isNew ? null : (customers.find((c) => c.id === id) ?? null)
  if (!isNew && !customer) notFound()
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(20rem,26rem)_1fr]">
      <div className="hidden lg:block">
        <RecordList
          items={customerItems(customers)}
          selectedId={isNew ? null : id}
          basePath="/setup/customers"
          addLabel="Add"
          searchLabel="Search customers"
        />
      </div>
      {customer ? (
        <CustomerEditor
          key={id}
          customer={customer}
          contacts={contacts
            .filter((c) => c.customerId === customer.id)
            .map((c) => ({ id: c.id, name: c.name, title: c.title, active: c.active }))}
        />
      ) : (
        <NewCustomerForm />
      )}
    </div>
  )
}
