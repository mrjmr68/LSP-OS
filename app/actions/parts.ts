"use server"

import { revalidatePath } from "next/cache"

import { isSupabaseConfigured } from "@/lib/env"
import { isUuid } from "@/lib/setup"
import { createClient } from "@/lib/supabase/server"

type Result<T = null> = { ok: true; value: T } | { ok: false; message: string }

async function memberClient() {
  if (!isSupabaseConfigured()) return { ok: false as const, message: "The database is not connected." }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, message: "Sign in again." }
  return { ok: true as const, supabase }
}

function friendly(message: string | undefined): string {
  if (!message) return "That didn't save. Try again."
  if (/fetch failed|network/i.test(message)) return "No connection. Try again when you have signal."
  return message
}

function refresh(requestId: string) {
  revalidatePath(`/board/visit/${requestId}`)
  revalidatePath("/board")
  revalidatePath("/parts")
  revalidatePath("/review", "layout")
}

/** The tech hands the ordering to an owner. It shows under Needs you and on Parts. */
export async function askOwnerForPart(requestId: string, partsOrderId: string): Promise<Result> {
  const ready = await memberClient()
  if (!ready.ok) return ready
  if (!isUuid(partsOrderId) || !isUuid(requestId)) return { ok: false, message: "Reload the job." }
  const { error } = await ready.supabase.rpc("ask_owner_for_part", { parts_order_id: partsOrderId })
  if (error) return { ok: false, message: friendly(error.message) }
  refresh(requestId)
  return { ok: true, value: null }
}

export type OrderInput = {
  requestId: string
  partsOrderId: string
  description: string
  supplierId: string | null
  supplierContact: string
  orderNumber: string
  partNumber: string
  quotedCents: number | null
  expectedDelivery: string | null
}

/** Records the order: supplier, order and part numbers, the quoted cost, when it's due. */
export async function orderPart(input: OrderInput): Promise<Result> {
  const ready = await memberClient()
  if (!ready.ok) return ready
  if (!isUuid(input.partsOrderId) || !isUuid(input.requestId)) return { ok: false, message: "Reload the job." }
  if (input.supplierId && !isUuid(input.supplierId)) return { ok: false, message: "Pick the supplier again." }
  const { error } = await ready.supabase.rpc("order_part", {
    parts_order_id: input.partsOrderId,
    supplier_id: input.supplierId,
    supplier_contact_text: input.supplierContact.trim() || null,
    order_number: input.orderNumber.trim() || null,
    part_number: input.partNumber.trim() || null,
    quoted_cost_cents: input.quotedCents,
    expected_delivery: input.expectedDelivery || null,
    part_description: input.description.trim() || null,
  })
  if (error) return { ok: false, message: friendly(error.message) }
  refresh(input.requestId)
  return { ok: true, value: null }
}

/**
 * Part in hand: uploads the receipt photo, then records the actual cost.
 * The database refuses a variable-cost part without both.
 */
export async function receivePart(input: {
  requestId: string
  partsOrderId: string
  actualCents: number
  receipt: string | null
}): Promise<Result> {
  const ready = await memberClient()
  if (!ready.ok) return ready
  if (!isUuid(input.partsOrderId) || !isUuid(input.requestId)) return { ok: false, message: "Reload the job." }
  if (!Number.isInteger(input.actualCents) || input.actualCents < 0) {
    return { ok: false, message: "Enter what the part cost, like 412.50." }
  }

  let path: string | null = null
  if (input.receipt) {
    const match = input.receipt.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/)
    if (!match) return { ok: false, message: "That receipt photo didn't come through. Take it again." }
    path = `${input.partsOrderId}/${Date.now()}.${match[1] === "jpeg" ? "jpg" : match[1]}`
    const { error: uploadError } = await ready.supabase.storage
      .from("receipts")
      .upload(path, Buffer.from(match[2]!, "base64"), { contentType: `image/${match[1]}`, upsert: false })
    if (uploadError) return { ok: false, message: "The receipt photo didn't upload. Try again when you have signal." }
  }

  const { error } = await ready.supabase.rpc("receive_part", {
    parts_order_id: input.partsOrderId,
    actual_cost_cents: input.actualCents,
    receipt_path: path,
  })
  if (error) return { ok: false, message: friendly(error.message) }
  refresh(input.requestId)
  return { ok: true, value: null }
}

/** Owner, at invoice review: the part cost checked against the bill. */
export async function confirmPartCost(invoiceId: string, lineId: string, actualCents: number): Promise<Result> {
  const ready = await memberClient()
  if (!ready.ok) return ready
  if (!isUuid(lineId) || !isUuid(invoiceId)) return { ok: false, message: "Reload the invoice." }
  if (!Number.isInteger(actualCents) || actualCents < 0) return { ok: false, message: "Enter the part cost, like 412.50." }
  const { error } = await ready.supabase.rpc("confirm_part_cost", { line_id: lineId, actual_cost_cents: actualCents })
  if (error) return { ok: false, message: friendly(error.message) }
  revalidatePath(`/review/invoice/${invoiceId}`)
  revalidatePath("/review", "layout")
  return { ok: true, value: null }
}
