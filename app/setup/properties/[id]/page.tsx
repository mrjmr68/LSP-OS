import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { PropertyEditor } from "@/components/setup/property-editor"
import { PropertyList } from "@/components/setup/property-list"
import { isUuid } from "@/lib/setup"
import {
  loadCounties,
  loadCustomers,
  loadSetupProperties,
  requireOwner,
} from "@/lib/setup-data"

export const metadata: Metadata = {
  title: "Property",
}

export default async function SetupPropertyPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const isNew = id === "new"
  if (!isNew && !isUuid(id)) {
    notFound()
  }

  const supabase = await requireOwner()
  const [properties, counties, customers] = await Promise.all([
    loadSetupProperties(supabase),
    loadCounties(supabase),
    loadCustomers(supabase),
  ])
  const property = isNew ? null : (properties.find((p) => p.id === id) ?? null)
  if (!isNew && !property) {
    notFound()
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(20rem,26rem)_1fr]">
      <div className="hidden lg:block">
        <PropertyList items={properties} selectedId={isNew ? null : id} />
      </div>
      <PropertyEditor
        key={id}
        property={property}
        counties={counties}
        customers={customers}
      />
    </div>
  )
}
