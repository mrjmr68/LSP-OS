"use server"

import { revalidatePath } from "next/cache"

import { isBoardStatus, type BoardStatus } from "@/lib/board"
import { isSupabaseConfigured } from "@/lib/env"
import { createClient } from "@/lib/supabase/server"
import {
  isAttemptReason,
  isClosePath,
  type AttemptReason,
  type ClosePath,
  type Readings,
} from "@/lib/visit"

export type ActionFailure = { ok: false; message: string }
export type ActionSuccess<T> = { ok: true; data: T }
export type ActionResult<T> = ActionSuccess<T> | ActionFailure

export type VisitStep = {
  conflict: boolean
  boardStatus: BoardStatus | null
  visitStatus: string | null
  visitId: string | null
  requestUpdatedAt: string | null
  notice: string
  offlineConflict: boolean
  invoiceId: string | null
  estimateId: string | null
  partsOrderId: string | null
  attachmentId: string | null
  code: string | null
  title: string | null
  priceCents: number | null
  oneShot: boolean
  requiresModelSerial: boolean
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function markOnSite(input: {
  requestId: string
  source: "tap" | "gps"
  lat: number | null
  lng: number | null
  seenAt: string | null
}): Promise<ActionResult<VisitStep>> {
  const ready = await readyClient()
  if (!ready.ok) {
    return ready
  }
  if (!uuidPattern.test(input.requestId) || (input.source !== "tap" && input.source !== "gps")) {
    return { ok: false, message: "That call is not on the board." }
  }
  const { data, error } = await ready.supabase.rpc("mark_on_site", {
    request_id: input.requestId,
    arrival_source: input.source,
    lat: input.lat,
    lng: input.lng,
    seen_at: input.seenAt,
  })
  return finish(input.requestId, data, error)
}

export async function startJob(input: {
  requestId: string
  seenAt: string | null
}): Promise<ActionResult<VisitStep>> {
  const ready = await readyClient()
  if (!ready.ok) {
    return ready
  }
  if (!uuidPattern.test(input.requestId)) {
    return { ok: false, message: "That call is not on the board." }
  }
  const { data, error } = await ready.supabase.rpc("start_job", {
    request_id: input.requestId,
    seen_at: input.seenAt,
  })
  return finish(input.requestId, data, error)
}

export async function selectVisitBundle(input: {
  requestId: string
  bundleId: string
  seenAt: string | null
}): Promise<ActionResult<VisitStep>> {
  const ready = await readyClient()
  if (!ready.ok) {
    return ready
  }
  if (!uuidPattern.test(input.requestId) || !uuidPattern.test(input.bundleId)) {
    return { ok: false, message: "Pick a repair again." }
  }
  const { data, error } = await ready.supabase.rpc("select_visit_bundle", {
    request_id: input.requestId,
    bundle_id: input.bundleId,
    seen_at: input.seenAt,
  })
  return finish(input.requestId, data, error)
}

/** Add one more repair to the visit; earlier picks stay. */
export async function addVisitBundle(input: {
  requestId: string
  bundleId: string
  seenAt: string | null
}): Promise<ActionResult<VisitStep>> {
  const ready = await readyClient()
  if (!ready.ok) {
    return ready
  }
  if (!uuidPattern.test(input.requestId) || !uuidPattern.test(input.bundleId)) {
    return { ok: false, message: "Pick a repair again." }
  }
  const { data, error } = await ready.supabase.rpc("add_visit_bundle", {
    request_id: input.requestId,
    bundle_id: input.bundleId,
    seen_at: input.seenAt,
  })
  return finish(input.requestId, data, error)
}

export async function removeVisitBundle(input: {
  requestId: string
  selectionId: string
  seenAt: string | null
}): Promise<ActionResult<VisitStep>> {
  const ready = await readyClient()
  if (!ready.ok) {
    return ready
  }
  if (!uuidPattern.test(input.requestId) || !uuidPattern.test(input.selectionId)) {
    return { ok: false, message: "Open the visit again." }
  }
  const { data, error } = await ready.supabase.rpc("remove_visit_bundle", {
    request_id: input.requestId,
    selection_id: input.selectionId,
    seen_at: input.seenAt,
  })
  return finish(input.requestId, data, error)
}

export async function savePartsOrder(input: {
  requestId: string
  description: string
  supplierId: string | null
  supplierContact: string
  orderNumber: string
  expectedDelivery: string | null
  seenAt: string | null
}): Promise<ActionResult<VisitStep>> {
  const ready = await readyClient()
  if (!ready.ok) {
    return ready
  }
  if (!uuidPattern.test(input.requestId)) {
    return { ok: false, message: "That call is not on the board." }
  }
  if (input.supplierId && !uuidPattern.test(input.supplierId)) {
    return { ok: false, message: "Pick the supplier again." }
  }
  const { data, error } = await ready.supabase.rpc("save_parts_order", {
    request_id: input.requestId,
    part_description: input.description,
    supplier_id: input.supplierId,
    supplier_contact_text: input.supplierContact.trim() || null,
    order_number: input.orderNumber.trim() || null,
    expected_delivery: input.expectedDelivery || null,
    seen_at: input.seenAt,
  })
  return finish(input.requestId, data, error)
}

export async function markPartInHand(input: {
  requestId: string
  partsOrderId: string
  seenAt: string | null
}): Promise<ActionResult<VisitStep>> {
  const ready = await readyClient()
  if (!ready.ok) {
    return ready
  }
  if (!uuidPattern.test(input.partsOrderId)) {
    return { ok: false, message: "That part order is not on the call." }
  }
  const { data, error } = await ready.supabase.rpc("mark_part_in_hand", {
    parts_order_id: input.partsOrderId,
    seen_at: input.seenAt,
  })
  return finish(input.requestId, data, error)
}

export async function recordAttempt(input: {
  requestId: string
  reason: AttemptReason
  note: string
  seenAt: string | null
}): Promise<ActionResult<VisitStep>> {
  const ready = await readyClient()
  if (!ready.ok) {
    return ready
  }
  if (!uuidPattern.test(input.requestId) || !isAttemptReason(input.reason)) {
    return { ok: false, message: "Pick why you could not get in." }
  }
  const { data, error } = await ready.supabase.rpc("record_attempt", {
    request_id: input.requestId,
    reason: input.reason,
    tech_note: input.note,
    seen_at: input.seenAt,
  })
  return finish(input.requestId, data, error)
}

export async function attachVisitFile(input: {
  requestId: string
  kind: "photo" | "nameplate" | "signature"
  storagePath: string
  caption: string | null
  seenAt: string | null
}): Promise<ActionResult<VisitStep>> {
  const ready = await readyClient()
  if (!ready.ok) {
    return ready
  }
  if (!uuidPattern.test(input.requestId) || input.storagePath.trim() === "") {
    return { ok: false, message: "The file did not come through." }
  }
  if (input.storagePath.length > 500_000) {
    return { ok: false, message: "That photo is too large for this phone. Take it again, closer." }
  }
  const { data, error } = await ready.supabase.rpc("attach_visit_file", {
    request_id: input.requestId,
    kind: input.kind,
    storage_path: input.storagePath,
    caption: input.caption,
    seen_at: input.seenAt,
  })
  return finish(input.requestId, data, error)
}

export async function closeVisit(input: {
  requestId: string
  path: ClosePath
  note: string
  model: string
  serial: string
  equipmentSize: string
  readings: Readings
  signoffName: string
  oneOffNarrative: string
  materials: string
  partDescription: string
  supplierId: string | null
  supplierContact: string
  orderNumber: string
  expectedDelivery: string | null
  clientDraftId: string
  seenAt: string | null
}): Promise<ActionResult<VisitStep>> {
  const ready = await readyClient()
  if (!ready.ok) {
    return ready
  }
  if (!uuidPattern.test(input.requestId) || !isClosePath(input.path)) {
    return { ok: false, message: "Pick a path before closing." }
  }
  if (input.supplierId && !uuidPattern.test(input.supplierId)) {
    return { ok: false, message: "Pick the supplier again." }
  }
  const { data, error } = await ready.supabase.rpc("close_visit", {
    request_id: input.requestId,
    outcome: input.path,
    tech_note: input.note,
    model_typed: input.model.trim() || null,
    serial_typed: input.serial.trim() || null,
    equipment_size_text: input.equipmentSize.trim() || null,
    readings: input.readings,
    signoff_name: input.signoffName.trim() || null,
    one_off_narrative: input.oneOffNarrative.trim() || null,
    materials_text: input.materials.trim() || null,
    part_description: input.partDescription.trim() || null,
    supplier_id: input.supplierId,
    supplier_contact_text: input.supplierContact.trim() || null,
    order_number: input.orderNumber.trim() || null,
    expected_delivery: input.expectedDelivery || null,
    client_draft_id: uuidPattern.test(input.clientDraftId) ? input.clientDraftId : null,
    seen_at: input.seenAt,
  })
  return finish(input.requestId, data, error)
}

async function finish(
  requestId: string,
  data: unknown,
  error: { message: string } | null,
): Promise<ActionResult<VisitStep>> {
  if (error) {
    return { ok: false, message: actionMessage(error.message) }
  }
  revalidatePath("/board")
  revalidatePath(`/board/visit/${requestId}`)
  return { ok: true, data: readStep(data) }
}

function readStep(data: unknown): VisitStep {
  const row = data && typeof data === "object" ? (data as Record<string, unknown>) : {}
  const board = typeof row.board_status === "string" ? row.board_status : ""
  const price = row.price_cents
  return {
    conflict: row.conflict === true,
    boardStatus: isBoardStatus(board) ? board : null,
    visitStatus: typeof row.visit_status === "string" ? row.visit_status : null,
    visitId: typeof row.visit_id === "string" ? row.visit_id : null,
    requestUpdatedAt: typeof row.request_updated_at === "string" ? row.request_updated_at : null,
    notice: typeof row.notice === "string" ? row.notice : "",
    offlineConflict: row.offline_conflict === true,
    invoiceId: typeof row.invoice_id === "string" ? row.invoice_id : null,
    estimateId: typeof row.estimate_id === "string" ? row.estimate_id : null,
    partsOrderId: typeof row.parts_order_id === "string" ? row.parts_order_id : null,
    attachmentId: typeof row.attachment_id === "string" ? row.attachment_id : null,
    code: typeof row.code === "string" ? row.code : null,
    title: typeof row.title === "string" ? row.title : null,
    priceCents: typeof price === "number" ? price : null,
    oneShot: row.one_shot === true,
    requiresModelSerial: row.requires_model_serial === true,
  }
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
    return { ok: false, message: "Sign in again to update this call." }
  }
  return { ok: true, supabase }
}

function actionMessage(message: string): string {
  const line = message.split("\n")[0]?.replace(/^ERROR:\s+\w+:\s*/, "") ?? message
  if (/relation |syntax error|schema cache|stack|jwt|permission denied for/i.test(line)) {
    return "Could not save. Apply the latest database migration, then try again."
  }
  return line.slice(0, 280)
}
