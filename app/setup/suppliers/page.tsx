import type { Metadata } from "next"

import { EmptyPanel } from "@/components/setup/form-bits"
import { RecordList } from "@/components/setup/record-list"
import { supplierItems } from "@/components/setup/items"
import { loadSuppliers, requireOwner } from "@/lib/setup-data"

export const metadata: Metadata = { title: "Suppliers" }

export default async function SetupSuppliersPage() {
  const supabase = await requireOwner()
  const suppliers = await loadSuppliers(supabase)
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(20rem,26rem)_1fr]">
      <RecordList
        items={supplierItems(suppliers)}
        selectedId={null}
        basePath="/setup/suppliers"
        addLabel="Add"
        searchLabel="Search suppliers"
      />
      <EmptyPanel title="Suppliers">
        <p>
          The parts houses techs order from. Techs pick one on the parts screen and can call
          it with one tap. Retire a supplier you no longer use; past orders keep its name.
        </p>
      </EmptyPanel>
    </div>
  )
}
