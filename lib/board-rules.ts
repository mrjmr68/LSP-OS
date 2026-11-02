import {
  BOARD_CATEGORIES,
  type BoardStatus,
  statusLabel,
} from "./board"

const NORMAL_OWNER_MOVES: Record<BoardStatus, readonly BoardStatus[]> = {
  new: ["assigned", "ready", "to_estimate"],
  assigned: ["ready"],
  ready: ["assigned"],
  in_progress: [],
  to_estimate: ["estimate_out"],
  estimate_out: ["ready", "complete", "closed"],
  parts: ["ready"],
  complete: ["closed"],
  invoiced: ["closed"],
  closed: [],
}

/** Owner status switch. True when the move is not a normal Board step. */
export function ownerStatusNeedsReason(from: BoardStatus, to: BoardStatus): boolean {
  if (from === to) {
    return false
  }
  return !NORMAL_OWNER_MOVES[from].includes(to)
}

export function duplicateWarningText(input: {
  unitLabel: string
  issue: string
  status: BoardStatus
  createdAt: string
  nowMs: number
}): string {
  const elapsed = Math.max(0, input.nowMs - Date.parse(input.createdAt))
  const days = Math.floor(elapsed / 86_400_000)
  const when = days <= 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`
  const issue = input.issue.trim().replace(/\s+/g, " ")
  return `${input.unitLabel} had ${issue} ${when} — ${statusLabel(input.status)}`
}

export type QuickAddField = "contact" | "property" | "unit" | "issue"

export function quickAddMissing(input: {
  contactId: string
  propertyId: string
  unitId: string | null
  unitText: string
  issue: string
}): QuickAddField[] {
  const missing: QuickAddField[] = []
  if (!input.contactId) {
    missing.push("contact")
  }
  if (!input.propertyId) {
    missing.push("property")
  }
  if (!input.unitId && input.unitText.trim() === "") {
    missing.push("unit")
  }
  if (input.issue.trim() === "") {
    missing.push("issue")
  }
  return missing
}

export function pairNeedsLink(
  links: readonly { contactId: string; propertyId: string }[],
  contactId: string,
  propertyId: string,
): boolean {
  if (!contactId || !propertyId) {
    return false
  }
  return !links.some(
    (link) => link.contactId === contactId && link.propertyId === propertyId,
  )
}

export function mapsDirectionsUrl(
  address: string,
  origin?: { lat: number; lng: number } | null,
): string {
  const params = new URLSearchParams({
    api: "1",
    destination: address,
    travelmode: "driving",
  })
  if (
    origin &&
    Number.isFinite(origin.lat) &&
    Number.isFinite(origin.lng)
  ) {
    params.set("origin", `${origin.lat},${origin.lng}`)
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`
}

export function haversineMiles(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180
  const earthMiles = 3958.8
  const dLat = toRad(toLat - fromLat)
  const dLng = toRad(toLng - fromLng)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(fromLat)) * Math.cos(toRad(toLat)) * Math.sin(dLng / 2) ** 2
  return 2 * earthMiles * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Straight-line fallback when Google drive time is unavailable. 28 mph suburban. */
export function estimateDriveMinutes(miles: number): number {
  if (!Number.isFinite(miles) || miles <= 0) {
    return 1
  }
  return Math.max(1, Math.round((miles / 28) * 60))
}

export function minutesFromDistanceMatrix(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") {
    return null
  }
  const rows = (payload as { rows?: unknown }).rows
  if (!Array.isArray(rows)) {
    return null
  }
  const elements = (rows[0] as { elements?: unknown } | undefined)?.elements
  if (!Array.isArray(elements)) {
    return null
  }
  const element = elements[0] as
    | { status?: string; duration?: { value?: number } }
    | undefined
  if (element?.status !== "OK" || typeof element.duration?.value !== "number") {
    return null
  }
  return Math.max(1, Math.round(element.duration.value / 60))
}

const newYorkFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
})

export function formatInNewYork(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return ""
  }
  return newYorkFormat.format(date)
}

const RESIDENT_RULES: Record<string, string> = {
  confirm_with_property: "Confirm with the property before going.",
  just_go: "Resident reports: just go.",
  must_use_maintenance: "The resident has to go through maintenance.",
}

export function residentRuleText(mode: string | null, notes: string | null): string {
  const base = mode ? (RESIDENT_RULES[mode] ?? mode) : "No resident-report rule on file."
  const extra = notes?.trim()
  return extra ? `${base} ${extra}` : base
}

export function matchesQuery(text: string, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) {
    return true
  }
  return text.toLowerCase().includes(needle)
}

export const BOARD_STATUS_ORDER: BoardStatus[] = BOARD_CATEGORIES.map(
  (category) => category.status,
)
