import "server-only"

import { redirect } from "next/navigation"
import { connection } from "next/server"

import { isSupabaseConfigured } from "@/lib/env"
import type {
  CostKind,
  ReviewCostLine,
  ReviewLine,
  ReviewListItem,
  ReviewStatus,
} from "@/lib/review"
import { createClient } from "@/lib/supabase/server"

type Supabase = Awaited<ReturnType<typeof createClient>>

const OPEN_INVOICE = ["draft", "in_review", "flagged"]
const OPEN_ESTIMATE = ["draft", "in_review"]
const TZ = "America/New_York"

export type ReviewViewer = { id: string; fullName: string }

/** Review is owners only. Anyone else goes back to the Board. */
export async function requireReviewer(): Promise<{ supabase: Supabase; viewer: ReviewViewer }> {
  await connection()
  if (!isSupabaseConfigured()) redirect("/board")
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role, active")
    .eq("auth_user_id", user.id)
    .maybeSingle()
  const p = profile as { id: string; full_name: string; role: string; active: boolean } | null
  if (!p || !p.active || p.role !== "owner") redirect("/board")
  return { supabase, viewer: { id: p.id, fullName: p.full_name } }
}

function dayKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d)
}

/** "today", "yesterday", "Nov 17" in Greensboro time. */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const key = dayKey(d)
  if (key === dayKey(now)) return "today"
  if (key === dayKey(new Date(now.getTime() - 86_400_000))) return "yesterday"
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric" }).format(d)
}

async function crewNames(supabase: Supabase): Promise<Map<string, string>> {
  const { data } = await supabase.from("profiles").select("id, full_name")
  return new Map(((data ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]))
}

type TitleRow = {
  invoice_id?: string
  estimate_id?: string
  source: string
  description_customer: string
  visit_bundle_selections: { title_snap: string } | { title_snap: string }[] | null
}

function titleOf(row: TitleRow): string {
  const sel = Array.isArray(row.visit_bundle_selections)
    ? row.visit_bundle_selections[0]
    : row.visit_bundle_selections
  return sel?.title_snap ?? row.description_customer
}

/** Everything waiting on an owner: draft invoices, then draft estimates. */
export async function loadReviewList(supabase: Supabase): Promise<ReviewListItem[]> {
  const [invoicesResult, estimatesResult, names] = await Promise.all([
    supabase
      .from("invoice_records")
      .select(
        "id, status, total_cents, property_snap, unit_snap, created_at, flag_question, flag_answer, kind, service_requests ( assigned_user_id )",
      )
      .in("status", OPEN_INVOICE)
      .order("created_at", { ascending: true }),
    supabase
      .from("estimates")
      .select("id, status, total_cents, property_snap, unit_snap, created_at, created_by, equipment_size_text")
      .in("status", OPEN_ESTIMATE)
      .order("created_at", { ascending: true }),
    crewNames(supabase),
  ])

  type InvoiceRow = {
    id: string
    status: ReviewStatus
    total_cents: number
    property_snap: string
    unit_snap: string
    created_at: string
    flag_question: string | null
    flag_answer: string | null
    kind: "bundle" | "one_off"
    service_requests: { assigned_user_id: string | null } | { assigned_user_id: string | null }[] | null
  }
  type EstimateRow = {
    id: string
    status: ReviewListItem["status"]
    total_cents: number
    property_snap: string | null
    unit_snap: string | null
    created_at: string
    created_by: string
    equipment_size_text: string | null
  }
  const invoices = (invoicesResult.data ?? []) as InvoiceRow[]
  const estimates = (estimatesResult.data ?? []) as EstimateRow[]

  const [invoiceLines, estimateLines] = await Promise.all([
    invoices.length
      ? supabase
          .from("invoice_lines")
          .select("invoice_id, source, description_customer, visit_bundle_selections ( title_snap )")
          .in("invoice_id", invoices.map((i) => i.id))
          .order("sort")
      : Promise.resolve({ data: [] }),
    estimates.length
      ? supabase
          .from("estimate_lines")
          .select("estimate_id, source, description_customer, visit_bundle_selections ( title_snap )")
          .in("estimate_id", estimates.map((e) => e.id))
          .order("sort")
      : Promise.resolve({ data: [] }),
  ])
  const titlesBy = (rows: TitleRow[], key: "invoice_id" | "estimate_id") => {
    const map = new Map<string, { titles: string[]; repairs: number }>()
    for (const row of rows) {
      const id = row[key]
      if (!id) continue
      const entry = map.get(id) ?? { titles: [], repairs: 0 }
      entry.titles.push(titleOf(row))
      if (row.source === "bundle") entry.repairs += 1
      map.set(id, entry)
    }
    return map
  }
  const invoiceTitles = titlesBy((invoiceLines.data ?? []) as TitleRow[], "invoice_id")
  const estimateTitles = titlesBy((estimateLines.data ?? []) as TitleRow[], "estimate_id")

  const items: ReviewListItem[] = invoices.map((inv) => {
    const req = Array.isArray(inv.service_requests) ? inv.service_requests[0] : inv.service_requests
    const tech = req?.assigned_user_id ? (names.get(req.assigned_user_id) ?? null) : null
    const t = invoiceTitles.get(inv.id)
    return {
      kind: "invoice",
      id: inv.id,
      title: `${inv.property_snap} ${inv.unit_snap}`,
      amountCents: inv.total_cents,
      summary: t?.titles.join(" + ") || (inv.kind === "one_off" ? "One-off" : "Repair"),
      techName: tech,
      dateLabel: dayLabel(inv.created_at),
      repairCount: t?.repairs ?? 0,
      status: inv.status,
      question: inv.flag_question,
      answered: inv.flag_answer !== null && inv.status !== "flagged",
    }
  })
  for (const est of estimates) {
    const t = estimateTitles.get(est.id)
    items.push({
      kind: "estimate",
      id: est.id,
      title: `${est.property_snap ?? "Property"} ${est.unit_snap ?? ""}`.trim(),
      amountCents: est.total_cents,
      summary: [t?.titles.join(" + "), est.equipment_size_text].filter(Boolean).join(" · ") || "Estimate",
      techName: names.get(est.created_by) ?? null,
      dateLabel: dayLabel(est.created_at),
      repairCount: t?.repairs ?? 0,
      status: est.status,
      question: null,
      answered: false,
    })
  }
  return items
}

export type InvoiceReview = {
  id: string
  requestId: string
  status: ReviewStatus
  number: string | null
  updatedAt: string
  propertyName: string
  unitLabel: string
  issue: string
  techName: string | null
  techFirstName: string
  dateLabel: string
  minutes: { travel: number; access: number; work: number }
  lines: ReviewLine[]
  subtotalCents: number
  taxRateBps: number
  taxCents: number
  totalCents: number
  note: string | null
  oneOffNarrative: string | null
  materials: string | null
  photoCount: number
  billTo: { name: string | null; email: string | null; termsDays: number }
  question: string | null
  answer: string | null
  askedAt: string | null
  invoiceDate: string | null
  dueDate: string | null
  sentAt: string | null
  emailStatus: "sent" | "failed" | "queued" | null
}

export async function loadInvoiceReview(supabase: Supabase, id: string): Promise<InvoiceReview | null> {
  const { data: invData } = await supabase
    .from("invoice_records")
    .select(
      "id, request_id, status, number, updated_at, created_at, property_snap, unit_snap, subtotal_cents, tax_rate_bps_snap, tax_cents, total_cents, terms_days_snap, bill_to_customer_id, bill_to_email_snap, tech_one_off_narrative, materials_text, flag_question, flag_answer, flag_asked_at, invoice_date, due_date, sent_at",
    )
    .eq("id", id)
    .maybeSingle()
  if (!invData) return null
  const inv = invData as {
    id: string
    request_id: string
    status: ReviewStatus
    number: string | null
    updated_at: string
    created_at: string
    property_snap: string
    unit_snap: string
    subtotal_cents: number
    tax_rate_bps_snap: number
    tax_cents: number
    total_cents: number
    terms_days_snap: number
    bill_to_customer_id: string
    bill_to_email_snap: string
    tech_one_off_narrative: string | null
    materials_text: string | null
    flag_question: string | null
    flag_answer: string | null
    flag_asked_at: string | null
    invoice_date: string | null
    due_date: string | null
    sent_at: string | null
  }

  const [linesResult, costsResult, requestResult, visitsResult, customerResult, names, emailResult] =
    await Promise.all([
      supabase
        .from("invoice_lines")
        .select("id, sort, source, description_customer, amount_cents, visit_bundle_selections ( title_snap )")
        .eq("invoice_id", id)
        .order("sort"),
      supabase
        .from("invoice_cost_lines")
        .select("id, invoice_line_id, sort, kind, label, amount_cents, removed")
        .eq("invoice_id", id)
        .order("sort"),
      supabase.from("service_requests").select("issue, assigned_user_id").eq("id", inv.request_id).maybeSingle(),
      supabase
        .from("service_visits")
        .select("id, status, tech_note, closed_at, visit_seq, time_segments ( kind, started_at, ended_at )")
        .eq("request_id", inv.request_id)
        .order("visit_seq", { ascending: false }),
      supabase
        .from("customers")
        .select("billing_contact_id, billing_email_override")
        .eq("id", inv.bill_to_customer_id)
        .maybeSingle(),
      crewNames(supabase),
      supabase
        .from("outbound_messages")
        .select("status, created_at")
        .eq("request_id", inv.request_id)
        .eq("template", "invoice")
        .order("created_at", { ascending: false })
        .limit(1),
    ])

  type LineRow = TitleRow & { id: string; sort: number; amount_cents: number }
  type CostRow = {
    id: string
    invoice_line_id: string
    kind: CostKind
    label: string
    amount_cents: number
    removed: boolean
  }
  const costs = (costsResult.data ?? []) as CostRow[]
  const costBy = new Map<string, ReviewCostLine[]>()
  for (const c of costs) {
    const list = costBy.get(c.invoice_line_id) ?? []
    list.push({ id: c.id, kind: c.kind, label: c.label, amountCents: c.amount_cents, removed: c.removed })
    costBy.set(c.invoice_line_id, list)
  }
  const lines: ReviewLine[] = ((linesResult.data ?? []) as LineRow[]).map((row) => {
    const sel = Array.isArray(row.visit_bundle_selections) ? row.visit_bundle_selections[0] : row.visit_bundle_selections
    return {
      id: row.id,
      source: row.source as ReviewLine["source"],
      title: sel?.title_snap ?? null,
      description: row.description_customer,
      amountCents: row.amount_cents,
      costLines: costBy.get(row.id) ?? [],
    }
  })

  const request = requestResult.data as { issue: string; assigned_user_id: string | null } | null
  type VisitRow = {
    id: string
    status: string
    tech_note: string | null
    closed_at: string | null
    time_segments: { kind: string; started_at: string; ended_at: string | null }[] | null
  }
  const visits = (visitsResult.data ?? []) as VisitRow[]
  const visit = visits.find((v) => v.status === "closed") ?? visits[0] ?? null
  const minutes = { travel: 0, access: 0, work: 0 }
  for (const seg of visit?.time_segments ?? []) {
    if (!seg.ended_at) continue
    const m = (Date.parse(seg.ended_at) - Date.parse(seg.started_at)) / 60000
    if (seg.kind === "travel" || seg.kind === "access" || seg.kind === "work") minutes[seg.kind] += m
  }
  let photoCount = 0
  if (visit) {
    const { count } = await supabase
      .from("attachments")
      .select("id", { count: "exact", head: true })
      .eq("owner_type", "visit")
      .eq("owner_id", visit.id)
      .eq("kind", "photo")
    photoCount = count ?? 0
  }

  // Who it will bill once approved: the customer's billing contact.
  const customer = customerResult.data as { billing_contact_id: string; billing_email_override: string | null } | null
  let billName: string | null = null
  let billEmail: string | null = inv.bill_to_email_snap === "unset" ? null : inv.bill_to_email_snap
  if (customer && inv.status !== "approved_sent" && inv.status !== "paid") {
    const { data: contact } = await supabase
      .from("customer_contacts")
      .select("name, email")
      .eq("id", customer.billing_contact_id)
      .maybeSingle()
    const c = contact as { name: string; email: string | null } | null
    billName = c?.name ?? null
    billEmail = customer.billing_email_override?.trim() || c?.email?.trim() || billEmail
  }

  const techName = request?.assigned_user_id ? (names.get(request.assigned_user_id) ?? null) : null
  const email = ((emailResult.data ?? []) as { status: "sent" | "failed" | "queued" }[])[0]
  return {
    id: inv.id,
    requestId: inv.request_id,
    status: inv.status,
    number: inv.number,
    updatedAt: inv.updated_at,
    propertyName: inv.property_snap,
    unitLabel: inv.unit_snap,
    issue: request?.issue ?? "",
    techName,
    techFirstName: techName?.split(" ")[0] ?? "the tech",
    dateLabel: new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric" }).format(
      new Date(visit?.closed_at ?? inv.created_at),
    ),
    minutes,
    lines,
    subtotalCents: inv.subtotal_cents,
    taxRateBps: inv.tax_rate_bps_snap,
    taxCents: inv.tax_cents,
    totalCents: inv.total_cents,
    note: visit?.tech_note ?? null,
    oneOffNarrative: inv.tech_one_off_narrative,
    materials: inv.materials_text,
    photoCount,
    billTo: { name: billName, email: billEmail, termsDays: inv.terms_days_snap },
    question: inv.flag_question,
    answer: inv.flag_answer,
    askedAt: inv.flag_asked_at,
    invoiceDate: inv.invoice_date,
    dueDate: inv.due_date,
    sentAt: inv.sent_at,
    emailStatus: email?.status ?? null,
  }
}

export type EstimateReview = {
  id: string
  status: string
  propertyName: string
  unitLabel: string
  narrative: string
  equipmentSize: string | null
  techName: string | null
  dateLabel: string
  lines: { id: string; title: string; amountCents: number }[]
  subtotalCents: number
  taxCents: number
  totalCents: number
}

export async function loadEstimateReview(supabase: Supabase, id: string): Promise<EstimateReview | null> {
  const { data } = await supabase
    .from("estimates")
    .select(
      "id, status, property_snap, unit_snap, narrative, equipment_size_text, created_by, created_at, subtotal_cents, tax_cents, total_cents",
    )
    .eq("id", id)
    .maybeSingle()
  if (!data) return null
  const est = data as {
    id: string
    status: string
    property_snap: string | null
    unit_snap: string | null
    narrative: string
    equipment_size_text: string | null
    created_by: string
    created_at: string
    subtotal_cents: number
    tax_cents: number
    total_cents: number
  }
  const [linesResult, names] = await Promise.all([
    supabase
      .from("estimate_lines")
      .select("id, source, description_customer, amount_cents, visit_bundle_selections ( title_snap )")
      .eq("estimate_id", id)
      .order("sort"),
    crewNames(supabase),
  ])
  type Row = TitleRow & { id: string; amount_cents: number }
  return {
    id: est.id,
    status: est.status,
    propertyName: est.property_snap ?? "Property",
    unitLabel: est.unit_snap ?? "",
    narrative: est.narrative,
    equipmentSize: est.equipment_size_text,
    techName: names.get(est.created_by) ?? null,
    dateLabel: dayLabel(est.created_at),
    lines: ((linesResult.data ?? []) as Row[]).map((r) => ({ id: r.id, title: titleOf(r), amountCents: r.amount_cents })),
    subtotalCents: est.subtotal_cents,
    taxCents: est.tax_cents,
    totalCents: est.total_cents,
  }
}

/** For the Board's Review tab: how many drafts wait on an owner. */
export async function countReview(supabase: Supabase): Promise<number> {
  const [a, b] = await Promise.all([
    supabase.from("invoice_records").select("id", { count: "exact", head: true }).in("status", OPEN_INVOICE),
    supabase.from("estimates").select("id", { count: "exact", head: true }).in("status", OPEN_ESTIMATE),
  ])
  return (a.count ?? 0) + (b.count ?? 0)
}
