export const BOARD_CATEGORIES = [
  { status: "new", label: "New", hint: "Not triaged yet" },
  { status: "assigned", label: "Assigned", hint: "A tech has the first stop" },
  { status: "ready", label: "Ready", hint: "Nothing blocking it" },
  { status: "in_progress", label: "In Progress", hint: "En route or on site" },
  { status: "to_estimate", label: "To Estimate", hint: "Estimate is being built" },
  { status: "estimate_out", label: "Estimate Out", hint: "Waiting on the property" },
  { status: "parts", label: "Parts", hint: "Ordered, return visit pending" },
  { status: "complete", label: "Complete", hint: "Waiting on invoice review" },
  { status: "invoiced", label: "Invoiced", hint: "Sent, waiting on payment" },
  { status: "closed", label: "Closed", hint: "Paid" },
] as const

export type BoardStatus = (typeof BOARD_CATEGORIES)[number]["status"]

export type BoardCard = {
  id: string
  displayNumber: string
  issue: string
  status: BoardStatus
  priority: "normal" | "high"
  assignedUserId: string | null
  assigneeName: string | null
  propertyName: string
  unitLabel: string
  sourceLabel: string
  ageLabel: string
  bumpedAtMs: number | null
  createdAtMs: number
}

export type BoardViewer = {
  mode: "preview" | "authenticated"
  profileId: string | null
  fullName: string
  role: "owner" | "tech" | null
  email: string | null
}

const SOURCE_LABELS: Record<string, string> = {
  portal: "Portal",
  phone: "Phone",
  text: "Text",
  email: "Email",
  dispatcher: "Dispatcher",
  tech_direct: "Tech",
  onsite: "On site",
}

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source
}

export function isBoardStatus(value: string): value is BoardStatus {
  return BOARD_CATEGORIES.some((category) => category.status === value)
}

/** High first, then parts-arrived bump, then oldest. */
export function compareBoardCards(a: BoardCard, b: BoardCard): number {
  if (a.priority !== b.priority) {
    return a.priority === "high" ? -1 : 1
  }
  const bumpA = a.bumpedAtMs ?? 0
  const bumpB = b.bumpedAtMs ?? 0
  if (bumpA !== bumpB) {
    return bumpB - bumpA
  }
  return a.createdAtMs - b.createdAtMs
}

export function ageLabel(iso: string, nowMs: number): string {
  const minutes = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60000))
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.round(minutes / 60)
  if (hours < 48) {
    return `${hours}h`
  }
  return `${Math.round(hours / 24)}d`
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  const letters = parts.map((part) => part[0]?.toUpperCase() ?? "").join("")
  return letters || "—"
}
