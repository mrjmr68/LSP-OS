import "server-only"

import { connection } from "next/server"

import {
  ageLabel,
  type BoardCard,
  type BoardStatus,
  type BoardViewer,
  type RepeatCall,
  compareBoardCards,
  isBoardStatus,
  sourceLabel,
} from "@/lib/board"
import { formatInNewYork } from "@/lib/board-rules"
import { isSupabaseConfigured } from "@/lib/env"
import { emptyCatalog, type BoardCatalog, type BoardCrewMember, type PickerContact, type PickerLink, type PickerProperty } from "@/lib/quick-add"
import { createClient } from "@/lib/supabase/server"

export type BoardLoad =
  | {
      ok: true
      viewer: BoardViewer
      cards: BoardCard[]
      catalog: BoardCatalog
      catalogError: string | null
      profileMissing: boolean
    }
  | {
      ok: false
      viewer: BoardViewer
      message: string
    }

type ProfileRow = {
  id: string
  full_name: string
  role: "owner" | "tech"
  email: string
  active: boolean
}

type RequestRow = {
  id: string
  display_number: string
  issue: string
  board_status: string
  priority: "normal" | "high"
  assigned_user_id: string | null
  created_at: string
  board_sort_bumped_at: string | null
  source: string
  unit_id: string
  properties:
    | { name: string; address_line1: string; city: string; state: string; zip: string }
    | { name: string; address_line1: string; city: string; state: string; zip: string }[]
    | null
  units: { unit_label: string } | { unit_label: string }[] | null
  assignee: { full_name: string } | { full_name: string }[] | null
  customer_contacts: { name: string; phone: string | null } | { name: string; phone: string | null }[] | null
}

type RecentRow = {
  id: string
  unit_id: string
  issue: string
  board_status: string
  created_at: string
  display_number: string
  service_visits:
    | {
        visit_bundle_selections:
          | { code_snap: string | null }[]
          | { code_snap: string | null }
          | null
      }[]
    | {
        visit_bundle_selections:
          | { code_snap: string | null }[]
          | { code_snap: string | null }
          | null
      }
    | null
}

const previewViewer: BoardViewer = {
  mode: "preview",
  profileId: null,
  fullName: "Preview",
  role: null,
  email: null,
}

const requestSelect = `
  id,
  display_number,
  issue,
  board_status,
  priority,
  assigned_user_id,
  created_at,
  board_sort_bumped_at,
  source,
  unit_id,
  properties ( name, address_line1, city, state, zip ),
  units ( unit_label ),
  assignee:profiles!service_requests_assigned_user_id_fkey ( full_name ),
  customer_contacts ( name, phone )
`

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) {
    return null
  }
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function propertyAddress(property: {
  address_line1: string
  city: string
  state: string
  zip: string
} | null): string {
  if (!property) {
    return ""
  }
  return [property.address_line1, property.city, `${property.state} ${property.zip}`.trim()]
    .filter((part) => part.trim() !== "")
    .join(", ")
}

function bundleCodes(visits: RecentRow["service_visits"]): string[] {
  const list = !visits ? [] : Array.isArray(visits) ? visits : [visits]
  const codes = new Set<string>()
  for (const visit of list) {
    const selections = visit.visit_bundle_selections
    const rows = !selections ? [] : Array.isArray(selections) ? selections : [selections]
    for (const selection of rows) {
      if (selection.code_snap) {
        codes.add(selection.code_snap)
      }
    }
  }
  return [...codes]
}

export async function loadBoard(): Promise<BoardLoad> {
  await connection()

  if (!isSupabaseConfigured()) {
    return {
      ok: true,
      viewer: previewViewer,
      cards: [],
      catalog: emptyCatalog,
      catalogError: null,
      profileMissing: false,
    }
  }

  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return {
      ok: false,
      viewer: previewViewer,
      message: "Sign in again to load the board.",
    }
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, role, email, active")
    .eq("auth_user_id", user.id)
    .maybeSingle()

  if (profileError) {
    return {
      ok: false,
      viewer: {
        mode: "authenticated",
        profileId: null,
        fullName: user.email ?? "Signed in",
        role: null,
        email: user.email ?? null,
      },
      message: databaseMessage(profileError.message),
    }
  }

  const typedProfile = profile as ProfileRow | null
  const viewer: BoardViewer = {
    mode: "authenticated",
    profileId: typedProfile?.active ? typedProfile.id : null,
    fullName: typedProfile?.full_name ?? user.email ?? "Signed in",
    role: typedProfile?.active ? typedProfile.role : null,
    email: typedProfile?.email ?? user.email ?? null,
  }

  const [requestsResult, catalogResult] = await Promise.all([
    supabase.from("service_requests").select(requestSelect).is("deleted_at", null),
    loadCatalog(supabase),
  ])

  if (requestsResult.error) {
    return {
      ok: false,
      viewer,
      message: databaseMessage(requestsResult.error.message),
    }
  }

  const windowDays = catalogResult.windowDays
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString()
  const { data: recentData, error: recentError } = await supabase
    .from("service_requests")
    .select(
      `
        id,
        unit_id,
        issue,
        board_status,
        created_at,
        display_number,
        service_visits ( visit_bundle_selections ( code_snap ) )
      `,
    )
    .is("deleted_at", null)
    .gte("created_at", since)

  const repeatsByUnit = new Map<string, RepeatCall[]>()
  if (!recentError) {
    const recentRows = ((recentData ?? []) as RecentRow[]).sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
    )
    for (const row of recentRows) {
      if (!isBoardStatus(row.board_status)) {
        continue
      }
      const call: RepeatCall = {
        id: row.id,
        displayNumber: row.display_number,
        issue: row.issue,
        status: row.board_status,
        whenLabel: formatInNewYork(row.created_at),
        bundleCodes: bundleCodes(row.service_visits),
      }
      const list = repeatsByUnit.get(row.unit_id) ?? []
      list.push(call)
      repeatsByUnit.set(row.unit_id, list)
    }
  }

  const now = Date.now()
  const cards = ((requestsResult.data ?? []) as RequestRow[])
    .flatMap((row) => {
      if (!isBoardStatus(row.board_status)) {
        return []
      }
      const property = one(row.properties)
      const unit = one(row.units)
      const assignee = one(row.assignee)
      const contact = one(row.customer_contacts)
      const history = (repeatsByUnit.get(row.unit_id) ?? [])
        .filter((call) => call.id !== row.id)
        .slice(0, 8)
      const card: BoardCard = {
        id: row.id,
        displayNumber: row.display_number,
        issue: row.issue,
        status: row.board_status,
        priority: row.priority,
        assignedUserId: row.assigned_user_id,
        assigneeName: assignee?.full_name ?? null,
        propertyName: property?.name ?? "Property",
        unitId: row.unit_id,
        unitLabel: unit?.unit_label ?? "Unit",
        address: propertyAddress(property),
        contactName: contact?.name ?? "Contact",
        contactPhone: contact?.phone ?? null,
        sourceLabel: sourceLabel(row.source),
        ageLabel: ageLabel(row.created_at, now),
        bumpedAtMs: row.board_sort_bumped_at ? Date.parse(row.board_sort_bumped_at) : null,
        createdAtMs: Date.parse(row.created_at),
        repeatCalls: history,
        pendingSync: false,
      }
      return [card]
    })
    .sort(compareBoardCards)

  return {
    ok: true,
    viewer,
    cards,
    catalog: viewer.role === "owner" ? catalogResult.catalog : { ...catalogResult.catalog, crew: [] },
    catalogError: catalogResult.error,
    profileMissing: !typedProfile?.active,
  }
}

type CatalogResult = {
  catalog: BoardCatalog
  windowDays: number
  error: string | null
}

async function loadCatalog(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<CatalogResult> {
  const [contacts, properties, links, crew, config, contracts] = await Promise.all([
    supabase
      .from("customer_contacts")
      .select("id, name, customer_id, phone, active, customers ( name )")
      .eq("active", true)
      .order("name"),
    supabase
      .from("properties")
      .select("id, name, customer_id, address_line1, city, state, zip, active, customers ( name )")
      .eq("active", true)
      .order("name"),
    supabase.from("contact_properties").select("contact_id, property_id"),
    supabase.from("profiles").select("id, full_name, role, active").eq("active", true).order("full_name"),
    supabase.from("app_config").select("repeat_unit_window_days").eq("id", 1).maybeSingle(),
    supabase.from("property_contract").select("property_id, resident_report_mode, resident_report_notes"),
  ])

  const failed = [contacts.error, properties.error, links.error, crew.error].find(Boolean)
  if (failed) {
    return {
      catalog: emptyCatalog,
      windowDays: 14,
      error: "Contacts and properties did not load. Quick Add needs them.",
    }
  }

  const rules = new Map<string, { mode: string | null; notes: string | null }>()
  if (!contracts.error) {
    for (const row of (contracts.data ?? []) as {
      property_id: string
      resident_report_mode: string | null
      resident_report_notes: string | null
    }[]) {
      rules.set(row.property_id, {
        mode: row.resident_report_mode,
        notes: row.resident_report_notes,
      })
    }
  }

  const pickerContacts: PickerContact[] = ((contacts.data ?? []) as {
    id: string
    name: string
    customer_id: string
    phone: string | null
    customers: { name: string } | { name: string }[] | null
  }[]).map((row) => ({
    id: row.id,
    name: row.name,
    customerId: row.customer_id,
    customerName: one(row.customers)?.name ?? "",
    phone: row.phone,
  }))

  const pickerProperties: PickerProperty[] = ((properties.data ?? []) as {
    id: string
    name: string
    customer_id: string
    address_line1: string
    city: string
    state: string
    zip: string
    customers: { name: string } | { name: string }[] | null
  }[]).map((row) => {
    const rule = rules.get(row.id)
    return {
      id: row.id,
      name: row.name,
      customerId: row.customer_id,
      customerName: one(row.customers)?.name ?? "",
      address: propertyAddress(row),
      residentMode: rule?.mode ?? null,
      residentNotes: rule?.notes ?? null,
    }
  })

  const pickerLinks: PickerLink[] = ((links.data ?? []) as {
    contact_id: string
    property_id: string
  }[]).map((row) => ({
    contactId: row.contact_id,
    propertyId: row.property_id,
  }))

  const pickerCrew: BoardCrewMember[] = ((crew.data ?? []) as {
    id: string
    full_name: string
    role: "owner" | "tech"
  }[]).map((row) => ({
    id: row.id,
    fullName: row.full_name,
    role: row.role,
  }))

  const windowDays =
    (config.data as { repeat_unit_window_days: number } | null)?.repeat_unit_window_days ?? 14

  return {
    catalog: {
      contacts: pickerContacts,
      properties: pickerProperties,
      links: pickerLinks,
      crew: pickerCrew,
    },
    windowDays,
    error: null,
  }
}

function databaseMessage(message: string): string {
  if (/relation .* does not exist|schema cache|Could not find the table/i.test(message)) {
    return "The database is missing the LSP tables. Apply supabase/migrations, then refresh."
  }
  return "Could not load the board. Check the Supabase connection and try again."
}

export function repeatStatus(value: string): BoardStatus | null {
  return isBoardStatus(value) ? value : null
}
