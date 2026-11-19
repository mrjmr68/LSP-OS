import "server-only"

import { connection } from "next/server"

import { isBoardStatus, type BoardStatus } from "@/lib/board"
import { isSupabaseConfigured } from "@/lib/env"
import { createClient } from "@/lib/supabase/server"
import {
  emptyReadings,
  isClosePath,
  isSignoffRule,
  isVisitStatus,
  type ClosePath,
  type Readings,
  type SignoffRule,
  type VisitStatus,
} from "@/lib/visit"

export type VisitBundle = {
  id: string
  code: string
  title: string
  narrative: string
  pricingKind: "fixed" | "variable"
  priceCents: number
  oneShot: boolean
  quickSelectRank: number | null
  requiresModelSerial: boolean
  referencePart: string | null
}

export type VisitSupplier = {
  id: string
  name: string
  phone: string | null
  email: string | null
}

export type VisitPart = {
  id: string
  description: string
  supplierId: string | null
  supplierName: string | null
  supplierPhone: string | null
  supplierEmail: string | null
  contactText: string | null
  orderNumber: string
  expectedDelivery: string | null
  status: string
}

export type VisitModel = {
  requestId: string
  displayNumber: string
  issue: string
  boardStatus: BoardStatus
  priority: "normal" | "high"
  assignedUserId: string | null
  billable: boolean
  updatedAt: string
  propertyName: string
  unitLabel: string
  address: string
  lat: number | null
  lng: number | null
  geofenceRadiusM: number
  accessText: string | null
  lockbox: string | null
  contactName: string
  contactPhone: string | null
  signoff: SignoffRule
  signoffNotes: string | null
  viewerId: string
  viewerRole: "owner" | "tech"
  viewerName: string
  visit: {
    id: string
    status: VisitStatus
    path: ClosePath | null
    note: string
    model: string
    serial: string
    equipmentSize: string
    readings: Readings
    signoffName: string
    hasSignature: boolean
    syncState: "synced" | "pending"
    offlineConflict: boolean
  } | null
  selection: {
    bundleId: string | null
    code: string
    title: string
    priceCents: number
  } | null
  /** Every repair picked on this visit, oldest first. */
  selections: VisitSelection[]
  parts: VisitPart[]
  photoCount: number
  history: string[]
  /** "This unit before": repairs on earlier calls, newest first. */
  unitHistory: { title: string; whenLabel: string }[]
  /** Other calls on this unit inside the repeat window (14 days by default). */
  repeat: { count: number; windowDays: number } | null
  /** Over this total, the property wants an estimate first (null = no rule). */
  estimateOverCents: number | null
  /** The viewer's next job after this one, for "Next: …" on close. */
  nextJob: { id: string; title: string } | null
}

export type VisitSelection = {
  id: string
  bundleId: string | null
  code: string
  title: string
  priceCents: number
  oneShot: boolean
}

export type VisitLoad =
  | { ok: true; model: VisitModel; bundles: VisitBundle[]; suppliers: VisitSupplier[] }
  | { ok: false; message: string }

export async function loadVisit(requestId: string): Promise<VisitLoad> {
  await connection()
  if (!isSupabaseConfigured()) {
    return { ok: false, message: "Supabase is not connected yet." }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, message: "Sign in again to load the board." }
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, role, active")
    .eq("auth_user_id", user.id)
    .maybeSingle()
  if (profileError || !profile || !(profile as { active: boolean }).active) {
    return { ok: false, message: "This login is not on the crew list yet." }
  }
  const viewer = profile as { id: string; full_name: string; role: "owner" | "tech" }

  const { data: request, error: requestError } = await supabase
    .from("service_requests")
    .select(
      `
        id,
        display_number,
        issue,
        board_status,
        priority,
        assigned_user_id,
        billable,
        updated_at,
        property_id,
        unit_id,
        properties ( name, address_line1, city, state, zip, lat, lng, geofence_radius_m, lockbox_info ),
        units ( unit_label ),
        customer_contacts ( name, phone )
      `,
    )
    .eq("id", requestId)
    .is("deleted_at", null)
    .maybeSingle()

  if (requestError) {
    return { ok: false, message: "Could not open that call." }
  }
  if (!request) {
    return { ok: false, message: "That call is not on the board." }
  }

  const row = request as RequestRow
  if (!isBoardStatus(row.board_status)) {
    return { ok: false, message: "That call is not on the board." }
  }
  const property = one(row.properties)
  const unit = one(row.units)
  const contact = one(row.customer_contacts)

  const [contractResult, visitsResult, partsResult, bundlesResult, linesResult, suppliersResult] =
    await Promise.all([
      supabase
        .from("property_contract")
        .select("site_access_text, lockbox_info, signoff_requirement, signoff_notes, requires_estimate_over_cents")
        .eq("property_id", row.property_id)
        .maybeSingle(),
      supabase
        .from("service_visits")
        .select(
          "id, status, outcome_path, tech_note, model_typed, serial_typed, equipment_size_text, readings, signoff_name, signoff_signature_attachment_id, sync_state, offline_conflict, visit_seq",
        )
        .eq("request_id", requestId)
        .order("visit_seq", { ascending: false }),
      supabase
        .from("parts_orders")
        .select(
          "id, part_description, supplier_id, supplier_contact_text, order_number, expected_delivery_date, status, suppliers ( name, phone, email )",
        )
        .eq("request_id", requestId)
        .neq("status", "cancelled"),
      supabase
        .from("bundles")
        .select(
          "id, code, title, narrative, pricing_kind, target_price_cents, one_shot, quick_select_rank, requires_model_serial",
        )
        .eq("status", "active")
        .order("code"),
      supabase.from("bundle_lines").select("bundle_id, description, kind").eq("kind", "part"),
      supabase.from("suppliers").select("id, name, phone, email").eq("active", true).order("name"),
    ])

  const visits = (visitsResult.data ?? []) as VisitRow[]
  const active =
    visits.find((visit) =>
      ["planned", "en_route", "on_site", "working"].includes(visit.status),
    ) ?? visits[0] ?? null

  let selection: VisitModel["selection"] = null
  let selections: VisitSelection[] = []
  let photoCount = 0
  if (active) {
    const [selectionResult, photoResult] = await Promise.all([
      supabase
        .from("visit_bundle_selections")
        .select("id, bundle_id, code_snap, title_snap, price_cents_snap, bundles ( one_shot )")
        .eq("visit_id", active.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("attachments")
        .select("id", { count: "exact", head: true })
        .eq("owner_type", "visit")
        .eq("owner_id", active.id)
        .eq("kind", "photo"),
    ])
    type SelectionRow = {
      id: string
      bundle_id: string | null
      code_snap: string
      title_snap: string
      price_cents_snap: number
      bundles: { one_shot: boolean } | { one_shot: boolean }[] | null
    }
    const rows = (selectionResult.data ?? []) as SelectionRow[]
    selections = rows.map((r) => ({
      id: r.id,
      bundleId: r.bundle_id,
      code: r.code_snap,
      title: r.title_snap,
      priceCents: r.price_cents_snap,
      oneShot: one(r.bundles)?.one_shot === true,
    }))
    const picked = rows[rows.length - 1] ?? null
    if (picked) {
      selection = {
        bundleId: picked.bundle_id,
        code: picked.code_snap,
        title: picked.title_snap,
        priceCents: picked.price_cents_snap,
      }
    }
    photoCount = photoResult.count ?? 0
  }

  const referenceByBundle = new Map<string, string[]>()
  for (const line of (linesResult.data ?? []) as { bundle_id: string; description: string }[]) {
    const list = referenceByBundle.get(line.bundle_id) ?? []
    list.push(line.description)
    referenceByBundle.set(line.bundle_id, list)
  }

  const contract = contractResult.data as {
    site_access_text: string | null
    lockbox_info: string | null
    signoff_requirement: string | null
    signoff_notes: string | null
    requires_estimate_over_cents: number | null
  } | null

  const [history, unitHistory, repeat, nextJob] = await Promise.all([
    loadHistory(supabase, row.unit_id, requestId),
    loadUnitHistory(supabase, row.unit_id, requestId),
    loadRepeat(supabase, row.unit_id, requestId),
    loadNextJob(supabase, viewer.id, requestId),
  ])

  return {
    ok: true,
    model: {
      requestId: row.id,
      displayNumber: row.display_number,
      issue: row.issue,
      boardStatus: row.board_status,
      priority: row.priority,
      assignedUserId: row.assigned_user_id,
      billable: row.billable,
      updatedAt: row.updated_at,
      propertyName: property?.name ?? "Property",
      unitLabel: unit?.unit_label ?? "Unit",
      address: property
        ? [property.address_line1, property.city, `${property.state} ${property.zip}`.trim()]
            .filter((part) => part.trim() !== "")
            .join(", ")
        : "",
      lat: numberOrNull(property?.lat),
      lng: numberOrNull(property?.lng),
      geofenceRadiusM: property?.geofence_radius_m ?? 150,
      accessText: contract?.site_access_text ?? null,
      lockbox: contract?.lockbox_info ?? property?.lockbox_info ?? null,
      contactName: contact?.name ?? "Contact",
      contactPhone: contact?.phone ?? null,
      signoff: isSignoffRule(contract?.signoff_requirement) ? contract.signoff_requirement : "note_only",
      signoffNotes: contract?.signoff_notes ?? null,
      viewerId: viewer.id,
      viewerRole: viewer.role,
      viewerName: viewer.full_name,
      visit: active && isVisitStatus(active.status)
        ? {
            id: active.id,
            status: active.status,
            path: isClosePath(active.outcome_path) ? active.outcome_path : null,
            note: active.tech_note ?? "",
            model: active.model_typed ?? "",
            serial: active.serial_typed ?? "",
            equipmentSize: active.equipment_size_text ?? "",
            readings: readReadings(active.readings),
            signoffName: active.signoff_name ?? "",
            hasSignature: Boolean(active.signoff_signature_attachment_id),
            syncState: active.sync_state === "pending" ? "pending" : "synced",
            offlineConflict: active.offline_conflict,
          }
        : null,
      selection,
      selections,
      estimateOverCents: contract?.requires_estimate_over_cents ?? null,
      unitHistory,
      repeat,
      nextJob,
      parts: ((partsResult.data ?? []) as PartRow[]).map((part) => {
        const supplier = one(part.suppliers)
        return {
          id: part.id,
          description: part.part_description,
          supplierId: part.supplier_id,
          supplierName: supplier?.name ?? null,
          supplierPhone: supplier?.phone ?? null,
          supplierEmail: supplier?.email ?? null,
          contactText: part.supplier_contact_text,
          orderNumber: part.order_number ?? "",
          expectedDelivery: part.expected_delivery_date,
          status: part.status,
        }
      }),
      photoCount,
      history,
    },
    bundles: ((bundlesResult.data ?? []) as BundleRow[])
      .filter((bundle) => bundle.pricing_kind === "fixed" || bundle.pricing_kind === "variable")
      .sort((a, b) => {
        if (a.quick_select_rank === null && b.quick_select_rank !== null) {
          return 1
        }
        if (a.quick_select_rank !== null && b.quick_select_rank === null) {
          return -1
        }
        if (a.quick_select_rank !== null && b.quick_select_rank !== null && a.quick_select_rank !== b.quick_select_rank) {
          return a.quick_select_rank - b.quick_select_rank
        }
        return a.code.localeCompare(b.code)
      })
      .map((bundle) => ({
        id: bundle.id,
        code: bundle.code,
        title: bundle.title,
        narrative: bundle.narrative,
        pricingKind: bundle.pricing_kind,
        priceCents: bundle.target_price_cents,
        oneShot: bundle.one_shot,
        quickSelectRank: bundle.quick_select_rank,
        requiresModelSerial: bundle.requires_model_serial,
        referencePart: referenceByBundle.get(bundle.id)?.join(", ") ?? null,
      })),
    suppliers: ((suppliersResult.data ?? []) as VisitSupplier[]).map((supplier) => ({
      id: supplier.id,
      name: supplier.name,
      phone: supplier.phone,
      email: supplier.email,
    })),
  }
}

async function loadHistory(
  supabase: Awaited<ReturnType<typeof createClient>>,
  unitId: string,
  requestId: string,
): Promise<string[]> {
  const since = new Date()
  since.setMonth(since.getMonth() - 6)
  const { data } = await supabase
    .from("service_requests")
    .select("id, service_visits ( visit_bundle_selections ( code_snap ) )")
    .eq("unit_id", unitId)
    .neq("id", requestId)
    .is("deleted_at", null)
    .gte("created_at", since.toISOString())
    .limit(8)
  const codes = new Set<string>()
  for (const row of (data ?? []) as HistoryRow[]) {
    const visits = asList(row.service_visits)
    for (const visit of visits) {
      for (const selection of asList(visit.visit_bundle_selections)) {
        if (selection.code_snap) {
          codes.add(selection.code_snap)
        }
      }
    }
  }
  return [...codes]
}

type Supabase = Awaited<ReturnType<typeof createClient>>

const shortDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "America/New_York",
})

/** Repairs done on this unit on earlier calls, newest first (last 12 months). */
async function loadUnitHistory(
  supabase: Supabase,
  unitId: string,
  requestId: string,
): Promise<{ title: string; whenLabel: string }[]> {
  const since = new Date()
  since.setFullYear(since.getFullYear() - 1)
  const { data } = await supabase
    .from("service_requests")
    .select("id, issue, created_at, service_visits ( visit_bundle_selections ( title_snap ) )")
    .eq("unit_id", unitId)
    .neq("id", requestId)
    .is("deleted_at", null)
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(6)
  type Row = {
    issue: string
    created_at: string
    service_visits:
      | { visit_bundle_selections: { title_snap: string }[] | { title_snap: string } | null }[]
      | { visit_bundle_selections: { title_snap: string }[] | { title_snap: string } | null }
      | null
  }
  const items: { title: string; whenLabel: string }[] = []
  for (const r of (data ?? []) as Row[]) {
    const titles = asList(r.service_visits).flatMap((v) =>
      asList(v.visit_bundle_selections).map((sel) => sel.title_snap),
    )
    const when = shortDate.format(new Date(r.created_at))
    if (titles.length === 0) {
      items.push({ title: r.issue, whenLabel: when })
    } else {
      for (const title of titles) items.push({ title, whenLabel: when })
    }
  }
  return items.slice(0, 5)
}

async function loadRepeat(
  supabase: Supabase,
  unitId: string,
  requestId: string,
): Promise<{ count: number; windowDays: number } | null> {
  const { data: config } = await supabase
    .from("app_config")
    .select("repeat_unit_window_days")
    .eq("id", 1)
    .maybeSingle()
  const windowDays = (config as { repeat_unit_window_days: number } | null)?.repeat_unit_window_days ?? 14
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString()
  const { count } = await supabase
    .from("service_requests")
    .select("id", { count: "exact", head: true })
    .eq("unit_id", unitId)
    .neq("id", requestId)
    .is("deleted_at", null)
    .gte("created_at", since)
  return count && count > 0 ? { count, windowDays } : null
}

/** The viewer's next job in their My Jobs order, other than this one. */
async function loadNextJob(
  supabase: Supabase,
  profileId: string,
  requestId: string,
): Promise<{ id: string; title: string } | null> {
  const { data } = await supabase
    .from("service_requests")
    .select("id, properties ( name ), units ( unit_label )")
    .eq("assigned_user_id", profileId)
    .in("board_status", ["assigned", "ready"])
    .neq("id", requestId)
    .is("deleted_at", null)
    .order("my_jobs_position", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!data) return null
  const r = data as {
    id: string
    properties: { name: string } | { name: string }[] | null
    units: { unit_label: string } | { unit_label: string }[] | null
  }
  return {
    id: r.id,
    title: `${one(r.properties)?.name ?? "Property"} ${one(r.units)?.unit_label ?? ""}`.trim(),
  }
}

type RequestRow = {
  id: string
  display_number: string
  issue: string
  board_status: string
  priority: "normal" | "high"
  assigned_user_id: string | null
  billable: boolean
  updated_at: string
  property_id: string
  unit_id: string
  properties: PropertyEmbed | PropertyEmbed[] | null
  units: { unit_label: string } | { unit_label: string }[] | null
  customer_contacts: { name: string; phone: string | null } | { name: string; phone: string | null }[] | null
}

type PropertyEmbed = {
  name: string
  address_line1: string
  city: string
  state: string
  zip: string
  lat: number | string | null
  lng: number | string | null
  geofence_radius_m: number
  lockbox_info: string | null
}

type VisitRow = {
  id: string
  status: string
  outcome_path: string | null
  tech_note: string | null
  model_typed: string | null
  serial_typed: string | null
  equipment_size_text: string | null
  readings: unknown
  signoff_name: string | null
  signoff_signature_attachment_id: string | null
  sync_state: string
  offline_conflict: boolean
  visit_seq: number
}

type PartRow = {
  id: string
  part_description: string
  supplier_id: string | null
  supplier_contact_text: string | null
  order_number: string | null
  expected_delivery_date: string | null
  status: string
  suppliers: { name: string; phone: string | null; email: string | null } | { name: string; phone: string | null; email: string | null }[] | null
}

type BundleRow = {
  id: string
  code: string
  title: string
  narrative: string
  pricing_kind: "fixed" | "variable"
  target_price_cents: number
  one_shot: boolean
  quick_select_rank: number | null
  requires_model_serial: boolean
}

type HistoryRow = {
  id: string
  service_visits:
    | { visit_bundle_selections: { code_snap: string | null }[] | { code_snap: string | null } | null }[]
    | { visit_bundle_selections: { code_snap: string | null }[] | { code_snap: string | null } | null }
    | null
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) {
    return null
  }
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function asList<T>(value: T | T[] | null | undefined): T[] {
  if (!value) {
    return []
  }
  return Array.isArray(value) ? value : [value]
}

function numberOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") {
    return null
  }
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function readReadings(value: unknown): Readings {
  const readings = emptyReadings()
  if (!value || typeof value !== "object") {
    return readings
  }
  const row = value as Record<string, unknown>
  for (const key of Object.keys(readings) as (keyof Readings)[]) {
    if (typeof row[key] === "string") {
      readings[key] = row[key]
    }
  }
  return readings
}
