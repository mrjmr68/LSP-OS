import type { Metadata } from "next"

import { EmptyPanel } from "@/components/setup/form-bits"
import { customerItems } from "@/components/setup/items"
import { RecordList } from "@/components/setup/record-list"
import { loadCustomersFull, requireOwner } from "@/lib/setup-data"

export const metadata: Metadata = { title: "Customers" }

export default async function SetupCustomersPage() {
  const supabase = await requireOwner()
  const customers = await loadCustomersFull(supabase)
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(20rem,26rem)_1fr]">
      <RecordList
        items={customerItems(customers)}
        selectedId={null}
        basePath="/setup/customers"
        addLabel="Add"
        searchLabel="Search customers"
      />
      <EmptyPanel title="Customers">
        <p>
          Who gets the invoice: management companies, plus the occasional homeowner. Each
          customer has a billing contact, payment terms, and house rules that every one of its
          properties follows.
        </p>
      </EmptyPanel>
    </div>
  )
}
