/**
 * Board v1 rules (frozen design, Nov 18). Pure functions only: the
 * Board, the assign picker and My Jobs all read from these.
 */
import { compareBoardCards, type BoardCard, type BoardStatus } from "@/lib/board"

// ---------------------------------------------------------------------------
// Seven stages over the ten statuses
// ---------------------------------------------------------------------------

export const DISPLAY_STAGES = [
  { id: "new", label: "New", statuses: ["new", "assigned"] },
  { id: "ready", label: "Ready", statuses: ["ready"] },
  { id: "in_progress", label: "In Progress", statuses: ["in_progress"] },
  { id: "estimate", label: "Estimate", statuses: ["to_estimate", "estimate_out"] },
  { id: "parts", label: "Parts", statuses: ["parts"] },
  { id: "complete", label: "Complete", statuses: ["complete"] },
  { id: "invoiced", label: "Invoiced", statuses: ["invoiced"] },
] as const satisfies readonly { id: string; label: string; statuses: readonly BoardStatus[] }[]

export type DisplayStageId = (typeof DISPLAY_STAGES)[number]["id"]

/** On the phone these three show first; the rest wait behind "Show all stages". */
export const PHONE_NOW_STAGES: readonly DisplayStageId[] = ["ready", "new", "in_progress"]

export function displayStageOf(status: BoardStatus): DisplayStageId | null {
  for (const stage of DISPLAY_STAGES) {
    if ((stage.statuses as readonly BoardStatus[]).includes(status)) return stage.id
  }
  return null // closed: paid jobs drop off the Board
}

export type StageGroup = {
  id: DisplayStageId
  label: string
  cards: BoardCard[]
}

export function groupByDisplayStage(cards: readonly BoardCard[]): StageGroup[] {
  return DISPLAY_STAGES.map((stage) => ({
    id: stage.id,
    label: stage.label,
    cards: cards
      .filter((c) => displayStageOf(c.status) === stage.id)
      .sort(compareBoardCards),
  }))
}

// ---------------------------------------------------------------------------
// Distance and time
// ---------------------------------------------------------------------------

export function milesBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 3958.8
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function milesLabel(miles: number): string {
  if (miles < 0.3) return "right there"
  if (miles < 10) return `${miles.toFixed(1).replace(/\.0$/, "")} mi away`
  return `${Math.round(miles)} mi away`
}

export function minutesSince(sinceMs: number, nowMs: number): string {
  const minutes = Math.max(0, Math.round((nowMs - sinceMs) / 60_000))
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

// ---------------------------------------------------------------------------
// Crew
// ---------------------------------------------------------------------------

export type CrewInput = {
  id: string
  fullName: string
  role: "owner" | "tech"
  lastLat?: number | null
  lastLng?: number | null
}

export type CrewState = {
  id: string
  name: string
  role: "owner" | "tech"
  state: "free" | "driving" | "on_site"
  /** "Britton Village 4A" for the job they are driving to or standing in. */
  where: string | null
  sinceMs: number | null
  /** Best guess at where they are: last report, else the job they're at. */
  position: { lat: number; lng: number } | null
}

export function firstName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0] ?? fullName
  return first.charAt(0).toUpperCase() + first.slice(1)
}

export function crewStates(crew: readonly CrewInput[], cards: readonly BoardCard[]): CrewState[] {
  return crew.map((person) => {
    const live = cards
      .filter((c) => c.assignedUserId === person.id && c.status === "in_progress" && !c.pendingSync)
      .sort((a, b) => (b.fieldState?.sinceMs ?? 0) - (a.fieldState?.sinceMs ?? 0))[0]
    const reported =
      person.lastLat != null && person.lastLng != null
        ? { lat: person.lastLat, lng: person.lastLng }
        : null
    if (!live) {
      return {
        id: person.id,
        name: firstName(person.fullName),
        role: person.role,
        state: "free" as const,
        where: null,
        sinceMs: null,
        position: reported,
      }
    }
    const atJob =
      live.propertyLat != null && live.propertyLng != null
        ? { lat: live.propertyLat, lng: live.propertyLng }
        : null
    const onSite = live.fieldState?.kind !== "driving"
    return {
      id: person.id,
      name: firstName(person.fullName),
      role: person.role,
      state: onSite ? ("on_site" as const) : ("driving" as const),
      where: `${live.propertyName} ${live.unitLabel}`,
      sinceMs: live.fieldState?.sinceMs ?? null,
      // On site: they are at the job. Driving: last report beats the destination.
      position: onSite ? (atJob ?? reported) : (reported ?? atJob),
    }
  })
}

export function crewChipLabel(c: CrewState, wide: boolean): string {
  if (c.state === "free") return `${c.name} · free`
  if (c.state === "on_site") return wide ? `${c.name} · on site ${c.where}` : `${c.name} · ${c.where}`
  return wide ? `${c.name} · driving to ${c.where}` : `${c.name} · driving`
}

export type AssignChoice = CrewState & { miles: number | null }

/** Free people first, closest first (unknown distance last); then busy people. */
export function assignChoices(
  card: Pick<BoardCard, "propertyLat" | "propertyLng">,
  crew: readonly CrewState[],
): { free: AssignChoice[]; busy: AssignChoice[] } {
  const target =
    card.propertyLat != null && card.propertyLng != null
      ? { lat: card.propertyLat, lng: card.propertyLng }
      : null
  const withMiles = crew.map((c) => ({
    ...c,
    miles: target && c.position ? milesBetween(c.position, target) : null,
  }))
  const byDistance = (a: AssignChoice, b: AssignChoice) => {
    if (a.miles === null && b.miles === null) return a.name.localeCompare(b.name)
    if (a.miles === null) return 1
    if (b.miles === null) return -1
    return a.miles - b.miles
  }
  return {
    free: withMiles.filter((c) => c.state === "free").sort(byDistance),
    busy: withMiles.filter((c) => c.state !== "free").sort(byDistance),
  }
}

// ---------------------------------------------------------------------------
// My Jobs
// ---------------------------------------------------------------------------

const MY_JOB_STATUSES: readonly BoardStatus[] = ["in_progress", "assigned", "ready"]

/**
 * A person's current jobs in their order. The job they are on (In Progress)
 * always comes first; then their own order; then the Board's order.
 */
export function myJobs(cards: readonly BoardCard[], profileId: string | null): BoardCard[] {
  if (!profileId) return []
  return cards
    .filter((c) => c.assignedUserId === profileId && MY_JOB_STATUSES.includes(c.status))
    .sort((a, b) => {
      const live = Number(b.status === "in_progress") - Number(a.status === "in_progress")
      if (live !== 0) return live
      const pa = a.myJobsPosition ?? Number.MAX_SAFE_INTEGER
      const pb = b.myJobsPosition ?? Number.MAX_SAFE_INTEGER
      if (pa !== pb) return pa - pb
      return compareBoardCards(a, b)
    })
}

/** "Sam · next" or "Sam · 3rd" for an assigned card on the Board. */
export function queueLabel(card: BoardCard, cards: readonly BoardCard[]): string | null {
  if (!card.assignedUserId || !card.assigneeName) return null
  if (card.status !== "assigned" && card.status !== "ready" && card.status !== "new") return null
  const list = myJobs(cards, card.assignedUserId)
  const index = list.findIndex((c) => c.id === card.id)
  const name = firstName(card.assigneeName)
  if (index < 0) return name
  const ahead = list.slice(0, index).filter((c) => c.status !== "in_progress").length
  if (ahead === 0) return `${name} · next`
  const n = ahead + 1
  const suffix = n === 2 ? "nd" : n === 3 ? "rd" : "th"
  return `${name} · ${n}${suffix}`
}

/** Move one id within a list. */
export function moveId(ids: readonly string[], from: number, to: number): string[] {
  const next = [...ids]
  if (from < 0 || from >= next.length) return next
  const [item] = next.splice(from, 1)
  const clamped = Math.max(0, Math.min(next.length, to))
  next.splice(clamped, 0, item as string)
  return next
}

/** "Here 9 days ago" when this unit had another call recently. */
export function repeatBadge(card: Pick<BoardCard, "repeatCalls">, nowMs: number): string | null {
  const last = card.repeatCalls[0]
  if (!last) return null
  const days = Math.floor((nowMs - last.createdAtMs) / 86_400_000)
  if (days <= 0) return "Here earlier today"
  if (days === 1) return "Here yesterday"
  return `Here ${days} days ago`
}
