import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { RecordList } from "@/components/setup/record-list"
import { supplierItems } from "@/components/setup/items"
import { SupplierEditor } from "@/components/setup/supplier-editor"
import { isUuid } from "@/lib/setup"
import { loadSuppliers, requireOwner } from "@/lib/setup-data"

export const metadata: Metadata = { title: "Supplier" }

export default async function SetupSupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const isNew = id === "new"
  if (!isNew && !isUuid(id)) notFound()
  const supabase = await requireOwner()
  const suppliers = await loadSuppliers(supabase)
  const supplier = isNew ? null : (suppliers.find((s) => s.id === id) ?? null)
  if (!isNew && !supplier) notFound()
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(20rem,26rem)_1fr]">
      <div className="hidden lg:block">
        <RecordList
          items={supplierItems(suppliers)}
          selectedId={isNew ? null : id}
          basePath="/setup/suppliers"
          addLabel="Add"
          searchLabel="Search suppliers"
        />
      </div>
      <SupplierEditor key={id} supplier={supplier} />
    </div>
  )
}
