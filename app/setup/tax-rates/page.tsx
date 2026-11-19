import type { Metadata } from "next"

import { TaxRateTable } from "@/components/setup/tax-rate-table"
import { loadCounties, loadSetupProperties, requireOwner } from "@/lib/setup-data"

export const metadata: Metadata = {
  title: "Tax rates",
}

export default async function SetupTaxRatesPage() {
  const supabase = await requireOwner()
  const [counties, properties] = await Promise.all([
    loadCounties(supabase),
    loadSetupProperties(supabase),
  ])
  const inUse: Record<string, number> = {}
  for (const p of properties) {
    if (p.active && p.county) inUse[p.county] = (inUse[p.county] ?? 0) + 1
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-wide">Sales tax by county</h1>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Combined state and county rate. A change applies to every property in that county
          from the next invoice on. Invoices already made keep the rate they were made with.
        </p>
      </div>
      <TaxRateTable
        rows={counties.map((c) => ({ ...c, properties: inUse[c.county] ?? 0 }))}
      />
    </div>
  )
}
