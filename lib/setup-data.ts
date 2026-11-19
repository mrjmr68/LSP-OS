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
