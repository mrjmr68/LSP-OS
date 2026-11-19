"use server"

import { revalidatePath } from "next/cache"

import { isSupabaseConfigured } from "@/lib/env"
import {
  isUuid,
  parseRatePercent,
  validateProperty,
  type PropertyInput,
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
