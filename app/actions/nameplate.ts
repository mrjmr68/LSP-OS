"use server"

import { revalidatePath } from "next/cache"

import { askAboutPhoto } from "@/lib/claude-vision"
import { isSupabaseConfigured } from "@/lib/env"
import { METER_PROMPT, parseMeterReply } from "@/lib/meter"
import { NAMEPLATE_PROMPT, parseNameplateReply, type NameplateFields } from "@/lib/nameplate"
import { isUuid } from "@/lib/setup"
import { createClient } from "@/lib/supabase/server"
import type { Readings } from "@/lib/visit"

type Result<T> = { ok: true; value: T } | { ok: false; message: string }

async function memberClient() {
  if (!isSupabaseConfigured()) return { ok: false as const, message: "The database is not connected." }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, message: "Sign in again." }
  const { data: profile } = await supabase
    .from("profiles")
    .select("active")
    .eq("auth_user_id", user.id)
    .maybeSingle()
  if (!(profile as { active: boolean } | null)?.active) {
    return { ok: false as const, message: "This login is not on the crew list." }
  }
  return { ok: true as const, supabase }
}

/** Reads model, serial and the rest off a nameplate photo (a JPEG data URL). */
export async function readNameplate(dataUrl: string): Promise<Result<NameplateFields>> {
  const ready = await memberClient()
  if (!ready.ok) return ready
  const reply = await askAboutPhoto(dataUrl, NAMEPLATE_PROMPT)
  if (!reply.ok) return reply
  const fields = parseNameplateReply(reply.text)
  if (!fields || (!fields.model && !fields.serial)) {
    return { ok: false, message: "Couldn't find a model or serial in that photo. Try closer, with less glare." }
  }
  return { ok: true, value: fields }
}

/** Reads gauge and thermometer values off a meter photo into the visit readings. */
export async function readMeter(
  dataUrl: string,
): Promise<Result<{ values: Partial<Readings>; confidence: "high" | "low"; count: number }>> {
  const ready = await memberClient()
  if (!ready.ok) return ready
  const reply = await askAboutPhoto(dataUrl, METER_PROMPT)
  if (!reply.ok) return reply
  const parsed = parseMeterReply(reply.text)
  if (!parsed || parsed.count === 0) {
    return { ok: false, message: "Couldn't read any values. Get the whole display in the photo, with less glare." }
  }
  return { ok: true, value: parsed }
}

export type EquipmentInput = {
  id: string | null
  unitId: string
  kind: "ahu" | "condenser" | "heat_pump" | "furnace" | "other"
  brand: string
  model: string
  serial: string
  tons: string
  refrigerant: string
  year: string
}

/** Saves the unit's equipment record. It stays with the unit for every later visit. */
export async function saveEquipment(input: EquipmentInput): Promise<Result<{ id: string }>> {
  const ready = await memberClient()
  if (!ready.ok) return ready
  if (!isUuid(input.unitId) || (input.id !== null && !isUuid(input.id))) {
    return { ok: false, message: "Reload the job and try again." }
  }
  const tons = input.tons.trim() === "" ? null : Number(input.tons)
  if (tons !== null && (!Number.isFinite(tons) || tons <= 0 || tons > 25)) {
    return { ok: false, message: "Size is in tons, like 2.5." }
  }
  const year = input.year.trim() === "" ? null : Number(input.year)
  if (year !== null && (!Number.isInteger(year) || year < 1970 || year > new Date().getFullYear())) {
    return { ok: false, message: "Pick the year it was made." }
  }
  const row = {
    unit_id: input.unitId,
    kind: input.kind,
    brand: input.brand.trim() || null,
    model: input.model.trim().toUpperCase() || null,
    serial: input.serial.trim().toUpperCase() || null,
    tonnage: tons,
    refrigerant: input.refrigerant.trim() || null,
    manufactured_year: year,
  }
  const query =
    input.id === null
      ? ready.supabase.from("systems").insert(row).select("id").single()
      : ready.supabase.from("systems").update(row).eq("id", input.id).select("id").single()
  const { data, error } = await query
  if (error || !data) return { ok: false, message: "That didn't save. Try again when you have signal." }
  revalidatePath("/board/visit/[requestId]", "page")
  return { ok: true, value: { id: (data as { id: string }).id } }
}
