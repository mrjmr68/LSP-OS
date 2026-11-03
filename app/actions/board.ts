"use server"

import { revalidatePath } from "next/cache"

import { isBoardStatus, type BoardStatus } from "@/lib/board"
import { lookupDriveMinutes, type GeoPoint } from "@/lib/eta"
import { isSupabaseConfigured } from "@/lib/env"
import {
  QUICK_ADD_DEFAULT_REPORTED_BY_RESIDENT,
  QUICK_ADD_DEFAULT_SOURCE,
  type PropertyUnit,
} from "@/lib/quick-add"
import { createClient } from "@/lib/supabase/server"

export type ActionFailure = { ok: false; message: string }
export type ActionSuccess<T> = { ok: true; data: T }
export type ActionResult<T> = ActionSuccess<T> | ActionFailure

export type QuickAddInput = {
  contactId: string
  propertyId: string
  unitId: string | null
  newUnitLabel: string | null
  issue: string
  linkContact: boolean
}

export type QuickAddResult = {
  id: string
  displayNumber: string
  duplicate: {
    issue: string
    status: BoardStatus
    createdAt: string
  } | null
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function createQuickAdd(
  input: QuickAddInput,
): Promise<ActionResult<QuickAddResult>> {
  const ready = await readyClient()
  if (!ready.ok) {
    return ready
  }

  if (!uuidPattern.test(input.contactId) || !uuidPattern.test(input.propertyId)) {
    return { ok: false, message: "Pick a contact and a property." }
  }
  if (input.unitId && !uuidPattern.test(input.unitId)) {
    return { ok: false, message: "Pick a unit again." }
  }
  if (input.issue.trim() === "") {
    return { ok: false, message: "Issue is required." }
  }

  const { data, error } = await ready.supabase.rpc("create_quick_add", {
    contact_id: input.contactId,
    property_id: input.propertyId,
    unit_id: input.unitId,
    new_unit_label: input.unitId ? null : input.newUnitLabel?.trim() || null,
    issue: input.issue.trim(),
    source: QUICK_ADD_DEFAULT_SOURCE,
    reported_by_resident: QUICK_ADD_DEFAULT_REPORTED_BY_RESIDENT,
    link_contact: input.linkContact,
  })

  if (error) {
    return { ok: false, message: actionMessage(error.message) }
  }

  const row = data as {
    id: string
    display_number: string
    duplicate_issue: string | null
    duplicate_status: string | null
    duplicate_created_at: string | null
  }

  revalidatePath("/board")
  return {
    ok: true,
    data: {
      id: row.id,
      displayNumber: row.display_number,
      duplicate:
        row.duplicate_issue && row.duplicate_status && isBoardStatus(row.duplicate_status)
          ? {
              issue: row.duplicate_issue,
              status: row.duplicate_status,
              createdAt: row.duplicate_created_at ?? new Date().toISOString(),
            }
          : null,
    },
  }
}

export async function loadPropertyUnits(
  propertyId: string,
): Promise<ActionResult<PropertyUnit[]>> {
  const ready = await readyClient()
  if (!ready.ok) {
    return ready
  }
  if (!uuidPattern.test(propertyId)) {
    return { ok: false, message: "Pick a property again." }
  }

  const [unitsResult, configResult, recentResult] = await Promise.all([
    ready.supabase
      .from("units")
      .select("id, unit_label")
      .eq("property_id", propertyId)
      .order("unit_label"),
    ready.supabase.from("app_config").select("repeat_unit_window_days").eq("id", 1).maybeSingle(),
    ready.supabase
      .from("service_requests")
      .select("unit_id, issue, board_status, created_at")
      .eq("property_id", propertyId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
  ])

  if (unitsResult.error) {
    return { ok: false, message: "Units did not load." }
  }

  const windowDays =
    (configResult.data as { repeat_unit_window_days: number } | null)?.repeat_unit_window_days ??
    14
  const cutoff = Date.now() - windowDays * 86_400_000
  const recentByUnit = new Map<string, PropertyUnit["recent"]>()
  if (!recentResult.error) {
    for (const row of (recentResult.data ?? []) as {
      unit_id: string
      issue: string
      board_status: string
      created_at: string
    }[]) {
      if (recentByUnit.has(row.unit_id)) {
        continue
      }
      if (Date.parse(row.created_at) < cutoff) {
        continue
      }
      recentByUnit.set(row.unit_id, {
        issue: row.issue,
        status: row.board_status,
        createdAt: row.created_at,
      })
    }
  }

  const units = ((unitsResult.data ?? []) as { id: string; unit_label: string }[])
    .map((unit) => ({
      id: unit.id,
      label: unit.unit_label,
      recent: recentByUnit.get(unit.id) ?? null,
    }))
    .sort((a, b) => {
      if (a.recent && !b.recent) {
        return -1
      }
      if (!a.recent && b.recent) {
        return 1
      }
      if (a.recent && b.recent) {
        return Date.parse(b.recent.createdAt) - Date.parse(a.recent.createdAt)
      }
      return a.label.localeCompare(b.label)
    })

  return { ok: true, data: units }
}

export async function goEnRoute(input: {
  requestId: string
  origin: GeoPoint | null
}): Promise<ActionResult<{ address: string; notice: string; etaMinutes: number | null }>> {
  const ready = await readyClient()
  if (!ready.ok) {
    return ready
  }
  if (!uuidPattern.test(input.requestId)) {
    return { ok: false, message: "That call is not on the board." }
  }

  const { data: located } = await ready.supabase
    .from("service_requests")
    .select("properties ( address_line1, city, state, zip, lat, lng )")
    .eq("id", input.requestId)
    .maybeSingle()

  const property = one(
    (located as {
      properties:
        | {
            address_line1: string
            city: string
            state: string
            zip: string
            lat: number | string | null
            lng: number | string | null
          }
        | {
            address_line1: string
            city: string
            state: string
            zip: string
            lat: number | string | null
            lng: number | string | null
          }[]
        | null
    } | null)?.properties,
  )
  const address = property
    ? [property.address_line1, property.city, `${property.state} ${property.zip}`.trim()]
        .filter((part) => part && part.trim() !== "")
        .join(", ")
    : ""
  const point = geoPoint(property?.lat ?? null, property?.lng ?? null)
  const etaMinutes = await lookupDriveMinutes(input.origin, address, point)

  const { data, error } = await ready.supabase.rpc("go_en_route", {
    request_id: input.requestId,
    eta_minutes: etaMinutes,
  })
  if (error) {
    return { ok: false, message: actionMessage(error.message) }
  }

  const row = data as { address: string; notice: string | null; eta_minutes: number | null }
  revalidatePath("/board")
  return {
    ok: true,
    data: {
      address: row.address || address,
      notice: row.notice ?? "On the way.",
      etaMinutes: row.eta_minutes,
    },
  }
}

export async function assignRequest(input: {
  requestId: string
  techId: string | null
}): Promise<ActionResult<{ assigned: boolean; status: BoardStatus | null }>> {
  const ready = await readyClient()
  if (!ready.ok) {
    return ready
  }
  if (!uuidPattern.test(input.requestId)) {
    return { ok: false, message: "That call is not on the board." }
  }
  if (input.techId && !uuidPattern.test(input.techId)) {
    return { ok: false, message: "Pick someone on the crew." }
  }

  const { data, error } = await ready.supabase.rpc("assign_request", {
    request_id: input.requestId,
    tech_id: input.techId,
  })
  if (error) {
    return { ok: false, message: actionMessage(error.message) }
  }
  revalidatePath("/board")
  const status = typeof data === "string" && isBoardStatus(data) ? data : null
  return { ok: true, data: { assigned: input.techId !== null, status } }
}

export async function setBoardStatus(input: {
  requestId: string
  status: BoardStatus
  reason: string
}): Promise<ActionResult<{ status: BoardStatus }>> {
  const ready = await readyClient()
  if (!ready.ok) {
    return ready
  }
  if (!uuidPattern.test(input.requestId) || !isBoardStatus(input.status)) {
    return { ok: false, message: "That status is not on the board." }
  }

  const { error } = await ready.supabase.rpc("set_board_status", {
    request_id: input.requestId,
    next_status: input.status,
    reason: input.reason.trim() || null,
  })
  if (error) {
    return { ok: false, message: actionMessage(error.message) }
  }
  revalidatePath("/board")
  return { ok: true, data: { status: input.status } }
}

export async function setRequestPriority(input: {
  requestId: string
  priority: "normal" | "high"
}): Promise<ActionResult<{ priority: "normal" | "high" }>> {
  const ready = await readyClient()
  if (!ready.ok) {
    return ready
  }
  if (!uuidPattern.test(input.requestId)) {
    return { ok: false, message: "That call is not on the board." }
  }

  const { error } = await ready.supabase.rpc("set_request_priority", {
    request_id: input.requestId,
    next_priority: input.priority,
  })
  if (error) {
    return { ok: false, message: actionMessage(error.message) }
  }
  revalidatePath("/board")
  return { ok: true, data: { priority: input.priority } }
}

export async function softDeleteRequest(
  requestId: string,
): Promise<ActionResult<{ deleted: true }>> {
  const ready = await readyClient()
  if (!ready.ok) {
    return ready
  }
  if (!uuidPattern.test(requestId)) {
    return { ok: false, message: "That call is not on the board." }
  }

  const { error } = await ready.supabase.rpc("soft_delete_request", {
    request_id: requestId,
  })
  if (error) {
    return { ok: false, message: actionMessage(error.message) }
  }
  revalidatePath("/board")
  return { ok: true, data: { deleted: true } }
}

async function readyClient(): Promise<
  ActionFailure | { ok: true; supabase: Awaited<ReturnType<typeof createClient>> }
> {
  if (!isSupabaseConfigured()) {
    return { ok: false, message: "Supabase is not connected yet." }
  }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, message: "Sign in again to change the board." }
  }
  return { ok: true, supabase }
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) {
    return null
  }
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function geoPoint(lat: number | string | null, lng: number | string | null): GeoPoint | null {
  const latitude = typeof lat === "number" ? lat : lat ? Number(lat) : NaN
  const longitude = typeof lng === "number" ? lng : lng ? Number(lng) : NaN
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null
  }
  return { lat: latitude, lng: longitude }
}

function actionMessage(message: string): string {
  const line = message.split("\n")[0]?.replace(/^ERROR:\s+\w+:\s*/, "") ?? message
  if (/relation |syntax error|schema cache|stack|jwt|permission denied for/i.test(line)) {
    return "Could not save. Apply the latest database migration, then try again."
  }
  return line.slice(0, 240)
}
