/** Shared Setup rules. No server imports: used by forms and actions alike. */

export function formatRate(bps: number): string {
  return `${(bps / 100).toFixed(bps % 10 === 0 ? 1 : 2)}%`
}

/** "7.25" or "7.25%" → 725. Null when it isn't a sensible NC rate. */
export function parseRatePercent(raw: string): number | null {
  const cleaned = raw.replace("%", "").trim()
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(cleaned)) return null
  const bps = Math.round(Number(cleaned) * 100)
  return bps >= 0 && bps <= 2000 ? bps : null
}

export type PropertyInput = {
  customerId: string
  name: string
  addressLine1: string
  city: string
  state: string
  zip: string
  county: string
  lat: string
  lng: string
  geofenceRadiusM: string
  siteAccessText: string
  lockboxInfo: string
}

export type CleanProperty = {
  customer_id: string
  name: string
  address_line1: string
  city: string
  state: string
  zip: string
  county: string | null
  lat: number | null
  lng: number | null
  geofence_radius_m: number
  site_access_text: string | null
  lockbox_info: string | null
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return uuidPattern.test(value)
}

/** NC sits roughly between these. A pin outside is almost certainly a mistake. */
const NC_BOUNDS = { minLat: 33.7, maxLat: 36.7, minLng: -84.4, maxLng: -75.3 }

export function validateProperty(
  input: PropertyInput,
): { ok: true; value: CleanProperty } | { ok: false; message: string } {
  const name = input.name.trim()
  const address = input.addressLine1.trim()
  const city = input.city.trim()
  const state = input.state.trim().toUpperCase() || "NC"
  const zip = input.zip.trim()

  if (!isUuid(input.customerId)) return { ok: false, message: "Pick the customer." }
  if (!name) return { ok: false, message: "Name is required." }
  if (!address) return { ok: false, message: "Street address is required." }
  if (!city) return { ok: false, message: "City is required." }
  if (!/^[A-Z]{2}$/.test(state)) return { ok: false, message: "State is two letters." }
  if (!/^\d{5}$/.test(zip)) return { ok: false, message: "Zip is 5 digits." }

  const latRaw = input.lat.trim()
  const lngRaw = input.lng.trim()
  let lat: number | null = null
  let lng: number | null = null
  if (latRaw || lngRaw) {
    lat = Number(latRaw)
    lng = Number(lngRaw)
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < NC_BOUNDS.minLat ||
      lat > NC_BOUNDS.maxLat ||
      lng < NC_BOUNDS.minLng ||
      lng > NC_BOUNDS.maxLng
    ) {
      return { ok: false, message: "The map pin is outside North Carolina." }
    }
    lat = Math.round(lat * 1e6) / 1e6
    lng = Math.round(lng * 1e6) / 1e6
  }

  const radius = Number(input.geofenceRadiusM.trim() || "150")
  if (!Number.isInteger(radius) || radius < 50 || radius > 1000) {
    return { ok: false, message: "Arrival radius is 50 to 1,000 meters." }
  }

  return {
    ok: true,
    value: {
      customer_id: input.customerId,
      name,
      address_line1: address,
      city,
      state,
      zip,
      county: input.county.trim() || null,
      lat,
      lng,
      geofence_radius_m: radius,
      site_access_text: input.siteAccessText.trim() || null,
      lockbox_info: input.lockboxInfo.trim() || null,
    },
  }
}

export type PropertyFilter = "active" | "needs-pin" | "retired" | "all"

export function matchesProperty(
  p: { name: string; city: string; addressLine1: string; county: string | null; active: boolean; lat: number | null },
  filter: PropertyFilter,
  query: string,
): boolean {
  if (filter === "active" && !p.active) return false
  if (filter === "retired" && p.active) return false
  if (filter === "needs-pin" && (!p.active || p.lat !== null)) return false
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [p.name, p.city, p.addressLine1, p.county ?? ""].some((s) =>
    s.toLowerCase().includes(q),
  )
}

// ---------------------------------------------------------------------------
// Suppliers, contacts, customers, team
// ---------------------------------------------------------------------------

type Check<T> = { ok: true; value: T } | { ok: false; message: string }

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function optional(raw: string): string | null {
  const t = raw.trim()
  return t === "" ? null : t
}

function checkEmail(raw: string): Check<string | null> {
  const email = optional(raw)
  if (email && !emailPattern.test(email)) return { ok: false, message: "That email doesn't look right." }
  return { ok: true, value: email ? email.toLowerCase() : null }
}

function checkPhone(raw: string): Check<string | null> {
  const phone = optional(raw)
  if (phone && phone.replace(/\D/g, "").length < 10) {
    return { ok: false, message: "Phone needs 10 digits." }
  }
  return { ok: true, value: phone }
}

export type SupplierInput = { name: string; branch: string; phone: string; email: string; notes: string }

export function validateSupplier(input: SupplierInput): Check<{
  name: string
  branch: string | null
  phone: string | null
  email: string | null
  notes: string | null
}> {
  const name = input.name.trim()
  if (!name) return { ok: false, message: "Supplier name is required." }
  const phone = checkPhone(input.phone)
  if (!phone.ok) return phone
  const email = checkEmail(input.email)
  if (!email.ok) return email
  return {
    ok: true,
    value: {
      name,
      branch: optional(input.branch),
      phone: phone.value,
      email: email.value,
      notes: optional(input.notes),
    },
  }
}

export type ContactInput = {
  customerId: string
  name: string
  title: string
  phone: string
  email: string
  smsOk: boolean
  propertyIds: string[]
}

export function validateContact(input: ContactInput): Check<{
  row: {
    customer_id: string
    name: string
    title: string | null
    phone: string | null
    email: string | null
    sms_ok: boolean
  }
  propertyIds: string[]
}> {
  if (!isUuid(input.customerId)) return { ok: false, message: "Pick the customer." }
  const name = input.name.trim()
  if (!name) return { ok: false, message: "Name is required." }
  const phone = checkPhone(input.phone)
  if (!phone.ok) return phone
  const email = checkEmail(input.email)
  if (!email.ok) return email
  if (input.propertyIds.some((id) => !isUuid(id))) {
    return { ok: false, message: "Pick the properties again." }
  }
  return {
    ok: true,
    value: {
      row: {
        customer_id: input.customerId,
        name,
        title: optional(input.title),
        phone: phone.value,
        email: email.value,
        sms_ok: input.smsOk,
      },
      propertyIds: [...new Set(input.propertyIds)],
    },
  }
}

export const ADDON_MODES = [
  { id: "do_under_limit", label: "Go ahead under a dollar limit" },
  { id: "call_first", label: "Call the property first" },
  { id: "estimate_required", label: "Send an estimate first" },
] as const
export const SIGNOFF_MODES = [
  { id: "none", label: "No sign-off" },
  { id: "note_only", label: "Note only" },
  { id: "walkthrough_signature", label: "Walkthrough and signature" },
  { id: "photos", label: "Photos" },
] as const
export const RESIDENT_MODES = [
  { id: "confirm_with_property", label: "Confirm with the property first" },
  { id: "just_go", label: "Just go" },
  { id: "must_use_maintenance", label: "Must go through maintenance" },
] as const

type AddonMode = (typeof ADDON_MODES)[number]["id"]
type SignoffMode = (typeof SIGNOFF_MODES)[number]["id"]
type ResidentMode = (typeof RESIDENT_MODES)[number]["id"]

export type CustomerInput = {
  name: string
  billingContactId: string
  billingEmailOverride: string
  paymentTermsDays: string
  siteAccessText: string
  addonApprovalMode: string
  addonApprovalLimit: string
  addonApprovalNotes: string
  signoffRequirement: string
  signoffNotes: string
  residentReportMode: string
  residentReportNotes: string
  requiresEstimateOver: string
}

/** "$250" or "250.50" → cents. Empty → null. */
export function parseDollars(raw: string): Check<number | null> {
  const t = raw.replace(/[$,\s]/g, "")
  if (t === "") return { ok: true, value: null }
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return { ok: false, message: "Dollar amounts look like 250 or 250.00." }
  return { ok: true, value: Math.round(Number(t) * 100) }
}

export function centsToDollars(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)
}

export function validateCustomer(input: CustomerInput): Check<{
  name: string
  billing_contact_id: string
  billing_email_override: string | null
  payment_terms_days: number
  site_access_text: string | null
  addon_approval_mode: AddonMode
  addon_approval_limit_cents: number | null
  addon_approval_notes: string | null
  signoff_requirement: SignoffMode
  signoff_notes: string | null
  resident_report_mode: ResidentMode
  resident_report_notes: string | null
  requires_estimate_over_cents: number | null
}> {
  const name = input.name.trim()
  if (!name) return { ok: false, message: "Customer name is required." }
  if (!isUuid(input.billingContactId)) return { ok: false, message: "Pick the billing contact." }
  const email = checkEmail(input.billingEmailOverride)
  if (!email.ok) return email
  const terms = Number(input.paymentTermsDays.trim())
  if (!Number.isInteger(terms) || terms < 0 || terms > 120) {
    return { ok: false, message: "Payment terms are 0 to 120 days." }
  }
  const addon = ADDON_MODES.find((m) => m.id === input.addonApprovalMode)
  const signoff = SIGNOFF_MODES.find((m) => m.id === input.signoffRequirement)
  const resident = RESIDENT_MODES.find((m) => m.id === input.residentReportMode)
  if (!addon || !signoff || !resident) return { ok: false, message: "Pick each rule again." }
  const limit = parseDollars(input.addonApprovalLimit)
  if (!limit.ok) return limit
  if (addon.id === "do_under_limit" && limit.value === null) {
    return { ok: false, message: "Enter the dollar limit for add-ons." }
  }
  const estimateOver = parseDollars(input.requiresEstimateOver)
  if (!estimateOver.ok) return estimateOver
  return {
    ok: true,
    value: {
      name,
      billing_contact_id: input.billingContactId,
      billing_email_override: email.value,
      payment_terms_days: terms,
      site_access_text: optional(input.siteAccessText),
      addon_approval_mode: addon.id,
      addon_approval_limit_cents: addon.id === "do_under_limit" ? limit.value : null,
      addon_approval_notes: optional(input.addonApprovalNotes),
      signoff_requirement: signoff.id,
      signoff_notes: optional(input.signoffNotes),
      resident_report_mode: resident.id,
      resident_report_notes: optional(input.residentReportNotes),
      requires_estimate_over_cents: estimateOver.value,
    },
  }
}

export type TeamInput = { fullName: string; phone: string; truckLabel: string; role: string; active: boolean }

export function validateTeamMember(input: TeamInput): Check<{
  full_name: string
  phone: string
  truck_label: string | null
  role: "owner" | "tech"
  active: boolean
}> {
  const fullName = input.fullName.trim()
  if (!fullName) return { ok: false, message: "Name is required." }
  const phone = checkPhone(input.phone)
  if (!phone.ok) return phone
  if (input.role !== "owner" && input.role !== "tech") return { ok: false, message: "Pick Owner or Tech." }
  return {
    ok: true,
    value: {
      full_name: fullName,
      phone: phone.value ?? "unset",
      truck_label: optional(input.truckLabel),
      role: input.role,
      active: input.active,
    },
  }
}
