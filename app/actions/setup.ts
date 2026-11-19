"use server"

import { revalidatePath } from "next/cache"

import { isSupabaseConfigured } from "@/lib/env"
import {
  isUuid,
  parseRatePercent,
  validateContact,
  validateCustomer,
  validateProperty,
  validateSupplier,
  validateTeamMember,
  type ContactInput,
  type CustomerInput,
  type PropertyInput,
  type SupplierInput,
  type TeamInput,
} from "@/lib/setup"
import { createClient } from "@/lib/supabase/server"

export type SetupResult<T = null> =
  | { ok: true; value: T }
  | { ok: false; message: string }

/** Every Setup action re-checks the owner role. RLS checks it again. */
async function ownerClient() {
  if (!isSupabaseConfigured()) {
    return { ok: false as const, message: "The database is not connected." }
  }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false as const, message: "Sign in again." }
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, active")
    .eq("auth_user_id", user.id)
    .maybeSingle()
  if (!profile?.active || profile.role !== "owner") {
    return { ok: false as const, message: "Only owners can change Setup." }
  }
  return { ok: true as const, supabase }
}

export async function saveProperty(
  id: string | null,
  input: PropertyInput,
): Promise<SetupResult<{ id: string }>> {
  const ready = await ownerClient()
  if (!ready.ok) return ready
  if (id !== null && !isUuid(id)) return { ok: false, message: "Open the property again." }

  const checked = validateProperty(input)
  if (!checked.ok) return checked

  const query =
    id === null
      ? ready.supabase.from("properties").insert(checked.value).select("id").single()
      : ready.supabase
          .from("properties")
          .update(checked.value)
          .eq("id", id)
          .select("id")
          .single()

  const { data, error } = await query
  if (error || !data) {
    return { ok: false, message: "That didn't save. Check the fields and try again." }
  }
  revalidatePath("/setup/properties")
  revalidatePath("/board")
  return { ok: true, value: { id: data.id as string } }
}

export async function setPropertyActive(
  id: string,
  active: boolean,
): Promise<SetupResult> {
  const ready = await ownerClient()
  if (!ready.ok) return ready
  if (!isUuid(id)) return { ok: false, message: "Open the property again." }

  if (!active) {
    const { count } = await ready.supabase
      .from("service_requests")
      .select("id", { count: "exact", head: true })
      .eq("property_id", id)
      .is("deleted_at", null)
      .not("board_status", "in", "(invoiced,closed)")
    if ((count ?? 0) > 0) {
      return {
        ok: false,
        message: `This property has ${count} open job${count === 1 ? "" : "s"}. Finish or move them first.`,
      }
    }
  }

  const { error } = await ready.supabase.from("properties").update({ active }).eq("id", id)
  if (error) return { ok: false, message: "That didn't save. Try again." }
  revalidatePath("/setup/properties")
  revalidatePath("/board")
  return { ok: true, value: null }
}

export type MapHit = { lat: number; lng: number; label: string }

/**
 * Looks an address up on OpenStreetMap so the pin starts near the right
 * place. The owner then drags the pin onto the building.
 */
export async function findAddressOnMap(address: string): Promise<SetupResult<MapHit>> {
  const ready = await ownerClient()
  if (!ready.ok) return ready
  const q = address.trim()
  if (q.length < 5) return { ok: false, message: "Enter the address first." }

  const url = new URL("https://nominatim.openstreetmap.org/search")
  url.searchParams.set("format", "jsonv2")
  url.searchParams.set("limit", "1")
  url.searchParams.set("countrycodes", "us")
  url.searchParams.set("q", q)
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "LSP-OS/1.0 (Legend Service Pros field app)" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return { ok: false, message: "Map search is not answering. Drag the pin instead." }
    const hits = (await response.json()) as { lat: string; lon: string; display_name: string }[]
    const hit = hits[0]
    if (!hit) return { ok: false, message: "No match for that address. Drag the pin instead." }
    return {
      ok: true,
      value: { lat: Number(hit.lat), lng: Number(hit.lon), label: hit.display_name },
    }
  } catch {
    return { ok: false, message: "Map search is not answering. Drag the pin instead." }
  }
}

export async function updateCountyRate(
  county: string,
  ratePercent: string,
): Promise<SetupResult<{ rateBps: number }>> {
  const ready = await ownerClient()
  if (!ready.ok) return ready
  const rateBps = parseRatePercent(ratePercent)
  if (rateBps === null) return { ok: false, message: "Enter a rate like 7.25." }

  const { data, error } = await ready.supabase
    .from("nc_county_tax_rates")
    .update({ rate_bps: rateBps, effective_date: new Date().toISOString().slice(0, 10) })
    .eq("county", county)
    .select("county")
  if (error || !data || data.length !== 1) {
    return { ok: false, message: "That didn't save. Try again." }
  }
  revalidatePath("/setup/tax-rates")
  revalidatePath("/setup/properties")
  return { ok: true, value: { rateBps } }
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export async function saveSupplier(
  id: string | null,
  input: SupplierInput,
): Promise<SetupResult<{ id: string }>> {
  const ready = await ownerClient()
  if (!ready.ok) return ready
  if (id !== null && !isUuid(id)) return { ok: false, message: "Open the supplier again." }
  const checked = validateSupplier(input)
  if (!checked.ok) return checked

  const { data, error } =
    id === null
      ? await ready.supabase.from("suppliers").insert(checked.value).select("id").single()
      : await ready.supabase.from("suppliers").update(checked.value).eq("id", id).select("id").single()
  if (error || !data) return { ok: false, message: "That didn't save. Try again." }
  revalidatePath("/setup/suppliers")
  return { ok: true, value: { id: data.id as string } }
}

export async function setSupplierActive(id: string, active: boolean): Promise<SetupResult> {
  const ready = await ownerClient()
  if (!ready.ok) return ready
  if (!isUuid(id)) return { ok: false, message: "Open the supplier again." }
  const { error } = await ready.supabase.from("suppliers").update({ active }).eq("id", id)
  if (error) return { ok: false, message: "That didn't save. Try again." }
  revalidatePath("/setup/suppliers")
  return { ok: true, value: null }
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export async function saveContact(
  id: string | null,
  input: ContactInput,
): Promise<SetupResult<{ id: string }>> {
  const ready = await ownerClient()
  if (!ready.ok) return ready
  if (id !== null && !isUuid(id)) return { ok: false, message: "Open the contact again." }
  const checked = validateContact(input)
  if (!checked.ok) return checked
  const { row, propertyIds } = checked.value

  // Links may only point at this customer's properties.
  if (propertyIds.length > 0) {
    const { data: owned, error } = await ready.supabase
      .from("properties")
      .select("id")
      .eq("customer_id", row.customer_id)
      .in("id", propertyIds)
    if (error || (owned ?? []).length !== propertyIds.length) {
      return { ok: false, message: "Those properties belong to a different customer." }
    }
  }

  const saved =
    id === null
      ? await ready.supabase.from("customer_contacts").insert(row).select("id").single()
      : await ready.supabase.from("customer_contacts").update(row).eq("id", id).select("id").single()
  if (saved.error || !saved.data) return { ok: false, message: "That didn't save. Try again." }
  const contactId = saved.data.id as string

  const { data: links, error: linksError } = await ready.supabase
    .from("contact_properties")
    .select("property_id")
    .eq("contact_id", contactId)
  if (linksError) return { ok: false, message: "Saved, but the property links didn't load. Try again." }
  const current = new Set((links ?? []).map((l) => l.property_id as string))
  const wanted = new Set(propertyIds)
  const remove = [...current].filter((p) => !wanted.has(p))
  const add = [...wanted].filter((p) => !current.has(p))

  if (remove.length > 0) {
    const { error } = await ready.supabase
      .from("contact_properties")
      .delete()
      .eq("contact_id", contactId)
      .in("property_id", remove)
    if (error) return { ok: false, message: "Saved, but a property link didn't come off. Try again." }
  }
  if (add.length > 0) {
    const { error } = await ready.supabase
      .from("contact_properties")
      .insert(add.map((property_id) => ({ contact_id: contactId, property_id })))
    if (error) return { ok: false, message: "Saved, but a property link didn't go on. Try again." }
  }

  revalidatePath("/setup/contacts")
  revalidatePath("/board")
  return { ok: true, value: { id: contactId } }
}

export async function setContactActive(id: string, active: boolean): Promise<SetupResult> {
  const ready = await ownerClient()
  if (!ready.ok) return ready
  if (!isUuid(id)) return { ok: false, message: "Open the contact again." }
  if (!active) {
    const { count } = await ready.supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("billing_contact_id", id)
    if ((count ?? 0) > 0) {
      return {
        ok: false,
        message: "This is a customer's billing contact. Pick a new billing contact on the customer first.",
      }
    }
  }
  const { error } = await ready.supabase.from("customer_contacts").update({ active }).eq("id", id)
  if (error) return { ok: false, message: "That didn't save. Try again." }
  revalidatePath("/setup/contacts")
  revalidatePath("/board")
  return { ok: true, value: null }
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export async function createCustomer(input: {
  name: string
  paymentTermsDays: string
  contactName: string
  contactTitle: string
  contactPhone: string
  contactEmail: string
}): Promise<SetupResult<{ id: string }>> {
  const ready = await ownerClient()
  if (!ready.ok) return ready
  const contact = validateContact({
    customerId: "00000000-0000-4000-8000-000000000000",
    name: input.contactName,
    title: input.contactTitle,
    phone: input.contactPhone,
    email: input.contactEmail,
    smsOk: true,
    propertyIds: [],
  })
  if (!contact.ok) return contact
  if (!input.name.trim()) return { ok: false, message: "Customer name is required." }
  const terms = Number(input.paymentTermsDays.trim() || "30")
  if (!Number.isInteger(terms) || terms < 0 || terms > 120) {
    return { ok: false, message: "Payment terms are 0 to 120 days." }
  }

  const { data, error } = await ready.supabase.rpc("create_customer", {
    p_name: input.name.trim(),
    p_payment_terms_days: terms,
    p_contact_name: contact.value.row.name,
    p_contact_title: contact.value.row.title,
    p_contact_phone: contact.value.row.phone,
    p_contact_email: contact.value.row.email,
  })
  if (error || !data) return { ok: false, message: "That didn't save. Try again." }
  revalidatePath("/setup/customers")
  return { ok: true, value: { id: data as string } }
}

export async function saveCustomer(id: string, input: CustomerInput): Promise<SetupResult> {
  const ready = await ownerClient()
  if (!ready.ok) return ready
  if (!isUuid(id)) return { ok: false, message: "Open the customer again." }
  const checked = validateCustomer(input)
  if (!checked.ok) return checked

  const { count } = await ready.supabase
    .from("customer_contacts")
    .select("id", { count: "exact", head: true })
    .eq("id", checked.value.billing_contact_id)
    .eq("customer_id", id)
    .eq("active", true)
  if ((count ?? 0) !== 1) {
    return { ok: false, message: "The billing contact must be an active contact of this customer." }
  }

  const { error } = await ready.supabase.from("customers").update(checked.value).eq("id", id)
  if (error) return { ok: false, message: "That didn't save. Try again." }
  revalidatePath("/setup/customers")
  return { ok: true, value: null }
}

export async function setCustomerActive(id: string, active: boolean): Promise<SetupResult> {
  const ready = await ownerClient()
  if (!ready.ok) return ready
  if (!isUuid(id)) return { ok: false, message: "Open the customer again." }
  if (!active) {
    const { count } = await ready.supabase
      .from("properties")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", id)
      .eq("active", true)
    if ((count ?? 0) > 0) {
      return {
        ok: false,
        message: `This customer still has ${count} active propert${count === 1 ? "y" : "ies"}. Retire those first.`,
      }
    }
  }
  const { error } = await ready.supabase.from("customers").update({ active }).eq("id", id)
  if (error) return { ok: false, message: "That didn't save. Try again." }
  revalidatePath("/setup/customers")
  return { ok: true, value: null }
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

export async function saveTeamMember(id: string, input: TeamInput): Promise<SetupResult> {
  const ready = await ownerClient()
  if (!ready.ok) return ready
  if (!isUuid(id)) return { ok: false, message: "Open the person again." }
  const checked = validateTeamMember(input)
  if (!checked.ok) return checked

  const { data, error } = await ready.supabase
    .from("profiles")
    .update(checked.value)
    .eq("id", id)
    .select("id")
  if (error) {
    if (error.code === "23514") {
      return { ok: false, message: "Keep at least one active owner, or no one can reach Setup." }
    }
    return { ok: false, message: "That didn't save. Try again." }
  }
  if (!data || data.length !== 1) return { ok: false, message: "That didn't save. Try again." }
  revalidatePath("/setup/team")
  revalidatePath("/board")
  return { ok: true, value: null }
}
