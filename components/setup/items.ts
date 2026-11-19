import type { RecordItem } from "@/components/setup/record-list"
import type { SetupContact, SetupCustomerFull, SetupSupplier } from "@/lib/setup-data"

/** Turn Setup records into list rows. Plain functions: safe on the server. */

export function supplierItems(rows: SetupSupplier[]): RecordItem[] {
  return rows.map((s) => ({
    id: s.id,
    title: s.name,
    subtitle: [s.branch, s.phone].filter(Boolean).join(" · ") || "No phone yet",
    active: s.active,
    searchText: `${s.email ?? ""} ${s.notes ?? ""}`,
  }))
}

export function contactItems(rows: SetupContact[]): RecordItem[] {
  return rows.map((c) => ({
    id: c.id,
    title: c.name,
    subtitle:
      [c.title, c.phone, `${c.propertyIds.length} propert${c.propertyIds.length === 1 ? "y" : "ies"}`]
        .filter(Boolean)
        .join(" · "),
    active: c.active,
    searchText: `${c.email ?? ""} ${c.customerName}`,
  }))
}

export function customerItems(rows: SetupCustomerFull[]): RecordItem[] {
  return rows.map((c) => ({
    id: c.id,
    title: c.name,
    subtitle: `${c.activeProperties} active propert${c.activeProperties === 1 ? "y" : "ies"} · ${c.paymentTermsDays}-day terms`,
    active: c.active,
  }))
}
