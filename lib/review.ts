// Owner review: plain helpers shared by the Review screens, the PDF and the email.

export type ReviewStatus = "draft" | "in_review" | "flagged" | "approved_sent" | "paid" | "void"

export type CostKind =
  | "labor"
  | "part"
  | "equipment"
  | "material"
  | "consumable"
  | "refrigerant"
  | "profit"

export type ReviewCostLine = {
  id: string
  kind: CostKind
  label: string
  amountCents: number
  removed: boolean
}

export type ReviewLine = {
  id: string
  source: "bundle" | "adjustment" | "one_off" | "trip"
  /** The repair name from the price book; null on added or one-off lines. */
  title: string | null
  description: string
  amountCents: number
  costLines: ReviewCostLine[]
}

export type ReviewListItem = {
  kind: "invoice" | "estimate"
  id: string
  title: string
  amountCents: number
  summary: string
  techName: string | null
  dateLabel: string
  repairCount: number
  status: ReviewStatus | "sent" | "viewed" | "accepted" | "declined"
  question: string | null
  answered: boolean
}

/** $400, $400.50, −$25 */
export function money(cents: number): string {
  const sign = cents < 0 ? "−" : ""
  const abs = Math.abs(cents)
  const whole = abs % 100 === 0
  const text = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(abs / 100)
  return sign + text
}

/** Always two decimals, for the PDF and totals: $1,234.50 */
export function moneyExact(cents: number): string {
  const sign = cents < 0 ? "−" : ""
  return (
    sign +
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
      Math.abs(cents) / 100,
    )
  )
}

/** "45", "$45.50", "-20", "1,200" → cents. Null when it isn't a number. */
export function parseDollars(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "").replace(/^−/, "-")
  if (!/^-?\d+(\.\d{0,2})?$/.test(cleaned) && !/^-?\.\d{1,2}$/.test(cleaned)) {
    return null
  }
  const value = Math.round(Number(cleaned) * 100)
  return Number.isFinite(value) ? value : null
}

/** 6.75% from 675 basis points. */
export function ratePercent(bps: number): string {
  return `${(bps / 100).toFixed(2).replace(/\.?0+$/, "")}%`
}

/** "41 min", "1 hr 5 min" */
export function minutesLabel(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest === 0 ? `${h} hr` : `${h} hr ${rest} min`
}

/** Tight version for tiles: "41m", "1h 5m". */
export function minutesShort(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  if (m < 60) return `${m}m`
  const rest = m % 60
  return rest === 0 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 60)}h ${rest}m`
}

/** The amber tag on a list card, or null. */
export function reviewTag(item: Pick<ReviewListItem, "repairCount" | "question" | "answered" | "techName">): {
  text: string
  tone: "amber" | "blue"
} | null {
  const first = item.techName?.split(" ")[0] ?? "the tech"
  if (item.question && !item.answered) return { text: `Asked ${first}`, tone: "blue" }
  if (item.question && item.answered) return { text: `${first} answered`, tone: "blue" }
  if (item.repairCount > 1) return { text: `${item.repairCount} repairs · set the price`, tone: "amber" }
  return null
}

/** The amber note above a multi-repair draft. */
export function multiRepairNote(repairCount: number): string | null {
  if (repairCount < 2) return null
  return `${repairCount} repairs on one visit. Every cost from each repair is listed, labor on each. Remove or change what doesn't apply.`
}

/** Totals the way the database does: tax rounds half up on the subtotal. */
export function invoiceTotals(lines: Pick<ReviewLine, "amountCents">[], taxRateBps: number) {
  const subtotal = lines.reduce((sum, l) => sum + l.amountCents, 0)
  const tax = subtotal > 0 ? Math.floor((subtotal * taxRateBps + 5000) / 10000) : 0
  return { subtotal, tax, total: subtotal + tax }
}

/** A repair's amount from its cost lines still in. */
export function lineAmount(costLines: Pick<ReviewCostLine, "amountCents" | "removed">[]): number {
  return costLines.reduce((sum, c) => (c.removed ? sum : sum + c.amountCents), 0)
}

export function invoiceEmail(input: {
  number: string
  propertyName: string
  unitLabel: string
  totalCents: number
  dueLabel: string
  companyName: string
}): { subject: string; text: string } {
  return {
    subject: `Invoice ${input.number} · ${input.propertyName} ${input.unitLabel}`,
    text: [
      "Hello,",
      "",
      `Attached is invoice ${input.number} for service at ${input.propertyName}, unit ${input.unitLabel}.`,
      `Amount due: ${moneyExact(input.totalCents)}, due ${input.dueLabel}.`,
      "",
      "Thank you,",
      input.companyName,
    ].join("\n"),
  }
}

/** Nov 17 (dates are yyyy-mm-dd, read as calendar dates). */
export function shortDate(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number)
  if (!y || !m || !d) return isoDate
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  return `${months[m - 1]} ${d}`
}

/** November 17, 2026 */
export function longDate(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number)
  if (!y || !m || !d) return isoDate
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ]
  return `${months[m - 1]} ${d}, ${y}`
}
