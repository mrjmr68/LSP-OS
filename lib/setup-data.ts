import "server-only"

import { redirect } from "next/navigation"
import { connection } from "next/server"

import { isSupabaseConfigured } from "@/lib/env"
import { createClient } from "@/lib/supabase/server"

export type SetupProperty = {
  id: string
  customerId: string
  customerName: string
  name: string
  addressLine1: string
  city: string
  state: string
  zip: string
  county: string | null
  taxRateBps: number
  lat: number | null
  lng: number | null
  geofenceRadiusM: number
  siteAccessText: string | null
  lockboxInfo: string | null
  active: boolean
}

export type SetupCounty = { county: string; rateBps: number }
export type SetupCustomer = { id: string; name: string; active: boolean }

type Supabase = Awaited<ReturnType<typeof createClient>>

/** Setup is owners only. Anyone else goes back to the Board. */
export async function requireOwner(): Promise<Supabase> {
  await connection()
  if (!isSupabaseConfigured()) {
    redirect("/board")
  }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect("/login")
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, active")
    .eq("auth_user_id", user.id)
    .maybeSingle()
  if (!profile || !profile.active || profile.role !== "owner") {
    redirect("/board")
  }
  return supabase
}

const propertySelect = `
  id, customer_id, name, address_line1, city, state, zip, county, tax_rate_bps,
  lat, lng, geofence_radius_m, site_access_text, lockbox_info, active,
  customers ( name )
`

type PropertyRow = {
  id: string
  customer_id: string
  name: string
  address_line1: string
  city: string
  state: string
  zip: string
  county: string | null
  tax_rate_bps: number
  lat: number | string | null
  lng: number | string | null
  geofence_radius_m: number
  site_access_text: string | null
  lockbox_info: string | null
  active: boolean
  customers: { name: string } | { name: string }[] | null
}

function toNumber(value: number | string | null): number | null {
  if (value === null) return null
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function toProperty(row: PropertyRow): SetupProperty {
  const customer = Array.isArray(row.customers) ? row.customers[0] : row.customers
  return {
    id: row.id,
    customerId: row.customer_id,
    customerName: customer?.name ?? "",
    name: row.name,
    addressLine1: row.address_line1,
    city: row.city,
    state: row.state,
    zip: row.zip,
    county: row.county,
    taxRateBps: row.tax_rate_bps,
    lat: toNumber(row.lat),
    lng: toNumber(row.lng),
    geofenceRadiusM: row.geofence_radius_m,
    siteAccessText: row.site_access_text,
    lockboxInfo: row.lockbox_info,
    active: row.active,
  }
}

export async function loadSetupProperties(supabase: Supabase): Promise<SetupProperty[]> {
  const { data, error } = await supabase
    .from("properties")
    .select(propertySelect)
    .order("name")
  if (error) {
    throw new Error("Properties could not be loaded.")
  }
  return (data as PropertyRow[]).map(toProperty)
}

export async function loadSetupProperty(
  supabase: Supabase,
  id: string,
): Promise<SetupProperty | null> {
  const { data, error } = await supabase
    .from("properties")
    .select(propertySelect)
    .eq("id", id)
    .maybeSingle()
  if (error) {
    throw new Error("The property could not be loaded.")
  }
  return data ? toProperty(data as PropertyRow) : null
}

export async function loadCounties(supabase: Supabase): Promise<SetupCounty[]> {
  const { data, error } = await supabase
    .from("nc_county_tax_rates")
    .select("county, rate_bps")
    .order("county")
  if (error) {
    throw new Error("County tax rates could not be loaded.")
  }
  return (data as { county: string; rate_bps: number }[]).map((r) => ({
    county: r.county,
    rateBps: r.rate_bps,
  }))
}

export async function loadCustomers(supabase: Supabase): Promise<SetupCustomer[]> {
  const { data, error } = await supabase
    .from("customers")
    .select("id, name, active")
    .order("name")
  if (error) {
    throw new Error("Customers could not be loaded.")
  }
  return data as SetupCustomer[]
}

// ---------------------------------------------------------------------------
// Suppliers, contacts, customers, team
// ---------------------------------------------------------------------------

export type SetupSupplier = {
  id: string
  name: string
  branch: string | null
  phone: string | null
  email: string | null
  notes: string | null
  active: boolean
}

export async function loadSuppliers(supabase: Supabase): Promise<SetupSupplier[]> {
  const { data, error } = await supabase
    .from("suppliers")
    .select("id, name, branch, phone, email, notes, active")
    .order("name")
  if (error) throw new Error("Suppliers could not be loaded.")
  return data as SetupSupplier[]
}

export type SetupContact = {
  id: string
  customerId: string
  customerName: string
  name: string
  title: string | null
  phone: string | null
  email: string | null
  smsOk: boolean
  active: boolean
  propertyIds: string[]
}

type ContactRow = {
  id: string
  customer_id: string
  name: string
  title: string | null
  phone: string | null
  email: string | null
  sms_ok: boolean
  active: boolean
  customers: { name: string } | { name: string }[] | null
  contact_properties: { property_id: string }[] | null
}

export async function loadContacts(supabase: Supabase): Promise<SetupContact[]> {
  const { data, error } = await supabase
    .from("customer_contacts")
    .select(
      "id, customer_id, name, title, phone, email, sms_ok, active, customers ( name ), contact_properties ( property_id )",
    )
    .order("name")
  if (error) throw new Error("Contacts could not be loaded.")
  return (data as ContactRow[]).map((r) => {
    const customer = Array.isArray(r.customers) ? r.customers[0] : r.customers
    return {
      id: r.id,
      customerId: r.customer_id,
      customerName: customer?.name ?? "",
      name: r.name,
      title: r.title,
      phone: r.phone,
      email: r.email,
      smsOk: r.sms_ok,
      active: r.active,
      propertyIds: (r.contact_properties ?? []).map((l) => l.property_id),
    }
  })
}

export type SetupCustomerFull = {
  id: string
  name: string
  billingContactId: string
  billingEmailOverride: string | null
  paymentTermsDays: number
  siteAccessText: string | null
  addonApprovalMode: string
  addonApprovalLimitCents: number | null
  addonApprovalNotes: string | null
  signoffRequirement: string
  signoffNotes: string | null
  residentReportMode: string
  residentReportNotes: string | null
  requiresEstimateOverCents: number | null
  active: boolean
  activeProperties: number
}

type CustomerRow = {
  id: string
  name: string
  billing_contact_id: string
  billing_email_override: string | null
  payment_terms_days: number
  site_access_text: string | null
  addon_approval_mode: string
  addon_approval_limit_cents: number | null
  addon_approval_notes: string | null
  signoff_requirement: string
  signoff_notes: string | null
  resident_report_mode: string
  resident_report_notes: string | null
  requires_estimate_over_cents: number | null
  active: boolean
  properties: { active: boolean }[] | null
}

export async function loadCustomersFull(supabase: Supabase): Promise<SetupCustomerFull[]> {
  const { data, error } = await supabase
    .from("customers")
    .select(
      `id, name, billing_contact_id, billing_email_override, payment_terms_days, site_access_text,
       addon_approval_mode, addon_approval_limit_cents, addon_approval_notes,
       signoff_requirement, signoff_notes, resident_report_mode, resident_report_notes,
       requires_estimate_over_cents, active, properties ( active )`,
    )
    .order("name")
  if (error) throw new Error("Customers could not be loaded.")
  return (data as CustomerRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    billingContactId: r.billing_contact_id,
    billingEmailOverride: r.billing_email_override,
    paymentTermsDays: r.payment_terms_days,
    siteAccessText: r.site_access_text,
    addonApprovalMode: r.addon_approval_mode,
    addonApprovalLimitCents: r.addon_approval_limit_cents,
    addonApprovalNotes: r.addon_approval_notes,
    signoffRequirement: r.signoff_requirement,
    signoffNotes: r.signoff_notes,
    residentReportMode: r.resident_report_mode,
    residentReportNotes: r.resident_report_notes,
    requiresEstimateOverCents: r.requires_estimate_over_cents,
    active: r.active,
    activeProperties: (r.properties ?? []).filter((p) => p.active).length,
  }))
}

export type SetupTeamMember = {
  id: string
  fullName: string
  email: string
  phone: string
  truckLabel: string | null
  role: "owner" | "tech"
  active: boolean
  isMe: boolean
}

export async function loadTeam(supabase: Supabase): Promise<SetupTeamMember[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from("profiles")
    .select("id, auth_user_id, full_name, email, phone, truck_label, role, active")
    .order("full_name")
  if (error) throw new Error("The team could not be loaded.")
  return (
    data as {
      id: string
      auth_user_id: string
      full_name: string
      email: string
      phone: string
      truck_label: string | null
      role: "owner" | "tech"
      active: boolean
    }[]
  ).map((r) => ({
    id: r.id,
    fullName: r.full_name,
    email: r.email,
    phone: r.phone === "unset" ? "" : r.phone,
    truckLabel: r.truck_label,
    role: r.role,
    active: r.active,
    isMe: r.auth_user_id === user?.id,
  }))
}
