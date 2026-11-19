import type { Metadata } from "next"

import { EmptyPanel } from "@/components/setup/form-bits"
import { contactItems } from "@/components/setup/items"
import { RecordList } from "@/components/setup/record-list"
import { loadContacts, requireOwner } from "@/lib/setup-data"

export const metadata: Metadata = { title: "Contacts" }

export default async function SetupContactsPage() {
  const supabase = await requireOwner()
  const contacts = await loadContacts(supabase)
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(20rem,26rem)_1fr]">
      <RecordList
        items={contactItems(contacts)}
        selectedId={null}
        basePath="/setup/contacts"
        addLabel="Add"
        searchLabel="Search name, phone, email"
      />
      <EmptyPanel title="Contacts">
        <p>
          Property managers and maintenance staff. Each contact works for one customer and
          handles one or more of its properties. Retire people who have moved on; their past
          jobs keep their name.
        </p>
      </EmptyPanel>
    </div>
  )
}
