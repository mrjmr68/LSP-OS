import type { Metadata } from "next"

import { PropertyList } from "@/components/setup/property-list"
import { loadSetupProperties, requireOwner } from "@/lib/setup-data"

export const metadata: Metadata = {
  title: "Properties",
}

export default async function SetupPropertiesPage() {
  const supabase = await requireOwner()
  const properties = await loadSetupProperties(supabase)

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(20rem,26rem)_1fr]">
      <PropertyList items={properties} selectedId={null} />
      <div className="hidden rounded-xl border border-dashed border-border p-8 text-sm leading-6 text-muted-foreground lg:block">
        <h1 className="font-display text-2xl font-semibold tracking-wide text-foreground">
          Properties
        </h1>
        <p className="mt-2 max-w-prose">
          Pick a property to change its address, county, map pin or access notes.
          Properties marked <span className="font-bold text-foreground">No pin</span> need
          a pin before the app can tell when a tech has arrived.
        </p>
      </div>
    </div>
  )
}
