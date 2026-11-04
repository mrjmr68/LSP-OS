import {
  BOARD_CATEGORIES,
  type BoardCard,
  type BoardStatus,
  compareBoardCards,
  isLiveBoardStatus,
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

const EN_ROUTE_NOT_READY = "This call is not ready to start."
const LOCATION_OFF_NOTE = " Location was off, so the text has no drive time."
const MAPS_NO_START_NOTE = " Location was off, so Maps has no start point."

export type EnRoutePoint = { lat: number; lng: number }

export type EnRouteServerResult =
  | { ok: true; address: string; notice: string }
  | { ok: false; message: string }

export type EnRouteOutcome =
  | { ok: false; message: string }
  | {
      ok: true
      mapsUrl: string
      address: string
      notice: string
      closeSheet: boolean
      sheetNote: string | null
    }

function usableOrigin(origin: EnRoutePoint | null): EnRoutePoint | null {
  if (!origin || !Number.isFinite(origin.lat) || !Number.isFinite(origin.lng)) {
    return null
  }
  return origin
}

/**
 * What the Board shows after location has already resolved.
 * Maps is a directions URL only. Never a blank tab.
 * A call that is already In Progress still gets that link.
 */
export function enRouteOutcome(input: {
  fallbackAddress: string
  origin: EnRoutePoint | null
  server: EnRouteServerResult
  mapsOpened: boolean
}): EnRouteOutcome {
  const origin = usableOrigin(input.origin)
  const locationNote = origin ? "" : LOCATION_OFF_NOTE

  if (!input.server.ok) {
    if (!input.server.message.includes(EN_ROUTE_NOT_READY)) {
      return { ok: false, message: input.server.message }
    }
    const address = input.fallbackAddress
    const mapsUrl = mapsDirectionsUrl(address, origin)
    const lead = "This call is already In Progress."
    const mapsNote = origin ? "" : MAPS_NO_START_NOTE
    if (input.mapsOpened) {
      return {
        ok: true,
        mapsUrl,
        address,
        notice: `${lead}${mapsNote}`,
        closeSheet: true,
        sheetNote: null,
      }
    }
    return {
      ok: true,
      mapsUrl,
      address,
      notice: `${lead}${mapsNote}`,
      closeSheet: false,
      sheetNote: `${lead} Open it in Maps below.${mapsNote}`,
    }
  }

  const address = input.server.address.trim() || input.fallbackAddress
  const mapsUrl = mapsDirectionsUrl(address, origin)
  const notice = `${input.server.notice}${locationNote}`
  if (input.mapsOpened) {
    return {
      ok: true,
      mapsUrl,
      address,
      notice,
      closeSheet: true,
      sheetNote: null,
    }
  }
  return {
    ok: true,
    mapsUrl,
    address,
    notice,
    closeSheet: false,
    sheetNote: `${notice} Tap Open in Maps.`,
  }
}

/**
 * Location first, while the Board is still the open page, then save, then Maps.
 * iOS Safari ties the location prompt to the visible tab, so a blank popup
 * opened first makes Allow or Deny stick to the wrong page.
 */
export async function runGoEnRoute(input: {
  fallbackAddress: string
  locate: () => Promise<EnRoutePoint | null>
  save: (origin: EnRoutePoint | null) => Promise<EnRouteServerResult>
  openMaps: (url: string) => boolean
}): Promise<EnRouteOutcome> {
  const origin = await input.locate()
  const server = await input.save(origin)
  const opened = enRouteOutcome({
    fallbackAddress: input.fallbackAddress,
    origin,
    server,
    mapsOpened: true,
  })
  if (!opened.ok) {
    return opened
  }
  let mapsOpened = false
  try {
    mapsOpened = input.openMaps(opened.mapsUrl)
  } catch {
    mapsOpened = false
  }
  if (mapsOpened) {
    return opened
  }
  return enRouteOutcome({
    fallbackAddress: input.fallbackAddress,
    origin,
    server,
    mapsOpened: false,
  })
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

export type CrewMemberRef = {
  id: string
  fullName: string
  role: "owner" | "tech"
}

export type CrewStandpointRow = CrewMemberRef & {
  jobs: BoardCard[]
}

const CURRENT_CALL_RANK: Record<BoardStatus, number> = {
  in_progress: 0,
  assigned: 1,
  ready: 2,
  to_estimate: 3,
  estimate_out: 4,
  parts: 5,
  new: 6,
  complete: 7,
  invoiced: 8,
  closed: 9,
}

/**
 * Who's where. One row per active crew member.
 * People with a live call come first, then free people. Each group is A–Z by name.
 * A live call is New through Parts. Complete, Invoiced, and Closed do not count as where they are.
 * When someone has several live calls, In Progress is first, then Assigned, then Ready, then the rest.
 */
export function crewStandpoint(
  crew: readonly CrewMemberRef[],
  cards: readonly BoardCard[],
): CrewStandpointRow[] {
  const jobsByPerson = new Map<string, BoardCard[]>()
  for (const card of cards) {
    if (!card.assignedUserId || card.pendingSync || !isLiveBoardStatus(card.status)) {
      continue
    }
    const list = jobsByPerson.get(card.assignedUserId)
    if (list) {
      list.push(card)
    } else {
      jobsByPerson.set(card.assignedUserId, [card])
    }
  }
  for (const list of jobsByPerson.values()) {
    list.sort((a, b) => {
      const rank = CURRENT_CALL_RANK[a.status] - CURRENT_CALL_RANK[b.status]
      if (rank !== 0) {
        return rank
      }
      return compareBoardCards(a, b)
    })
  }

  return crew
    .map((person) => ({
      id: person.id,
      fullName: person.fullName,
      role: person.role,
      jobs: jobsByPerson.get(person.id) ?? [],
    }))
    .sort((a, b) => {
      const busy = (b.jobs.length > 0 ? 1 : 0) - (a.jobs.length > 0 ? 1 : 0)
      if (busy !== 0) {
        return busy
      }
      return a.fullName.localeCompare(b.fullName, "en", { sensitivity: "base" })
    })
}
