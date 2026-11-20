import "server-only"

import {
  PART_SELECT,
  toVisitPart,
  type PartRow,
  type VisitPart,
  type VisitSupplier,
} from "@/lib/visit-data"
import { createClient } from "@/lib/supabase/server"

type Supabase = Awaited<ReturnType<typeof createClient>>

export type PartsDeskRow = {
  part: VisitPart
  requestId: string
  displayNumber: string
  propertyName: string
  unitLabel: string
  techName: string | null
  helpByName: string | null
  model: string
  serial: string
  boardStatus: string
}

export type PartsDesk = {
  toOrder: PartsDeskRow[]
  onOrder: PartsDeskRow[]
  inHand: PartsDeskRow[]
  suppliers: VisitSupplier[]
}

type One<T> = T | T[] | null
const first = <T>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)

type DeskRow = PartRow & {
  request_id: string
  owner_help_by: string | null
  service_visits: One<{ model_typed: string | null; serial_typed: string | null }>
  service_requests: One<{
    display_number: string | null
    board_status: string
    assigned_user_id: string | null
    deleted_at: string | null
    properties: One<{ name: string }>
    units: One<{ unit_label: string }>
  }>
}

/** Every open part order: to order, on order, and in hand waiting on the install. */
export async function loadPartsDesk(supabase: Supabase): Promise<PartsDesk> {
  const [ordersResult, suppliersResult, namesResult] = await Promise.all([
    supabase
      .from("parts_orders")
      .select(
        `${PART_SELECT}, request_id, owner_help_by, service_visits ( model_typed, serial_typed ), service_requests ( display_number, board_status, assigned_user_id, deleted_at, properties ( name ), units ( unit_label ) )`,
      )
      .in("status", ["needed", "ordered", "in_hand"])
      .order("created_at", { ascending: true }),
    supabase.from("suppliers").select("id, name, phone, email").eq("active", true).order("name"),
    supabase.from("profiles").select("id, full_name"),
  ])
  const names = new Map(
    ((namesResult.data ?? []) as { id: string; full_name: string }[]).map((p) => [
      p.id,
      p.full_name,
    ]),
  )
  const rows: PartsDeskRow[] = []
  for (const row of (ordersResult.data ?? []) as unknown as DeskRow[]) {
    const req = first(row.service_requests)
    if (!req || req.deleted_at) continue
    // In hand stays listed until the job is closed out.
    if (
      row.status === "in_hand" &&
      !["ready", "assigned", "in_progress", "parts"].includes(req.board_status)
    )
      continue
    const visit = first(row.service_visits)
    rows.push({
      part: toVisitPart(row),
      requestId: row.request_id,
      displayNumber: req.display_number ?? "",
      propertyName: first(req.properties)?.name ?? "Property",
      unitLabel: first(req.units)?.unit_label ?? "",
      techName: req.assigned_user_id ? (names.get(req.assigned_user_id) ?? null) : null,
      helpByName: row.owner_help_by ? (names.get(row.owner_help_by) ?? null) : null,
      model: visit?.model_typed ?? "",
      serial: visit?.serial_typed ?? "",
      boardStatus: req.board_status,
    })
  }
  const byHelp = (a: PartsDeskRow, b: PartsDeskRow) =>
    Number(Boolean(b.part.helpAskedAt)) - Number(Boolean(a.part.helpAskedAt))
  const byEta = (a: PartsDeskRow, b: PartsDeskRow) =>
    (a.part.expectedDelivery ?? "9999").localeCompare(b.part.expectedDelivery ?? "9999")
  return {
    toOrder: rows.filter((r) => r.part.status === "needed").sort(byHelp),
    onOrder: rows.filter((r) => r.part.status === "ordered").sort(byEta),
    inHand: rows.filter((r) => r.part.status === "in_hand"),
    suppliers: (suppliersResult.data ?? []) as VisitSupplier[],
  }
}
