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
