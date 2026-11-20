"use server"

import { revalidatePath } from "next/cache"

import { isSupabaseConfigured } from "@/lib/env"
import { NAMEPLATE_PROMPT, parseNameplateReply, type NameplateFields } from "@/lib/nameplate"
import { isUuid } from "@/lib/setup"
import { createClient } from "@/lib/supabase/server"

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
  const key = process.env.ANTHROPIC_API_KEY?.trim()
  if (!key) return { ok: false, message: "Scanning isn't set up yet (no AI key). Type the model and serial." }
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/)
  if (!match) return { ok: false, message: "That photo didn't come through. Try again." }
  if (match[2]!.length > 1_200_000) return { ok: false, message: "That photo is too large. Try again closer in." }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5-5",
        max_tokens: 400,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: match[1], data: match[2] } },
              { type: "text", text: NAMEPLATE_PROMPT },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) {
      console.error("Nameplate read failed", response.status)
      return { ok: false, message: "Couldn't read it this time. Type the model and serial, or try again." }
    }
    const body = (await response.json()) as { content?: { type: string; text?: string }[] }
    const text = body.content?.find((c) => c.type === "text")?.text ?? ""
    const fields = parseNameplateReply(text)
    if (!fields || (!fields.model && !fields.serial)) {
      return { ok: false, message: "Couldn't find a model or serial in that photo. Try closer, with less glare." }
    }
    return { ok: true, value: fields }
  } catch {
    return { ok: false, message: "No connection to the reader. Type the model and serial." }
  }
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
  const row = {
    unit_id: input.unitId,
    kind: input.kind,
    brand: input.brand.trim() || null,
    model: input.model.trim().toUpperCase() || null,
    serial: input.serial.trim().toUpperCase() || null,
    tonnage: tons,
    refrigerant: input.refrigerant.trim() || null,
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
