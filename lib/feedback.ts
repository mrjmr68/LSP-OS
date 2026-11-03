export const FEEDBACK_KINDS = [
  { kind: "bug", label: "Bug" },
  { kind: "observation", label: "Observation" },
  { kind: "suggestion", label: "Request / suggestion" },
] as const

export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]["kind"]

export type FeedbackContextInput = {
  path: string
  filter: "all" | "mine"
  requestId: string | null
  displayNumber: string | null
}

export type StoredFeedbackContext = {
  path: string
  filter: "all" | "mine"
  request_id: string | null
  display_number: string | null
  user_agent: string | null
}

export const FEEDBACK_BODY_MAX = 4000

/** Always notified when Resend is configured. Other active owners are added beside this. */
export const FEEDBACK_NOTICE_EMAIL = "matt@legsvc.com"

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const pathPattern = /^\/[A-Za-z0-9/_-]{0,199}$/
const displayPattern = /^LSP-\d{1,12}$/
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isFeedbackKind(value: string): value is FeedbackKind {
  return FEEDBACK_KINDS.some((item) => item.kind === value)
}

export function feedbackKindLabel(kind: FeedbackKind): string {
  return FEEDBACK_KINDS.find((item) => item.kind === kind)?.label ?? kind
}

export function feedbackDraftError(kind: string | null, body: string): string | null {
  if (!kind || !isFeedbackKind(kind)) {
    return "Pick a type."
  }
  const trimmed = body.trim()
  if (trimmed.length === 0) {
    return "Write at least one line."
  }
  if (trimmed.length > FEEDBACK_BODY_MAX) {
    return "Keep it shorter than 4000 characters."
  }
  return null
}

export function storedFeedbackContext(
  input: FeedbackContextInput,
  userAgent: string | null,
): StoredFeedbackContext {
  const path = pathPattern.test(input.path) ? input.path : "/board"
  const filter = input.filter === "mine" ? "mine" : "all"
  const requestId =
    input.requestId && uuidPattern.test(input.requestId) ? input.requestId : null
  const display = input.displayNumber?.trim() ?? ""
  const agent = userAgent?.trim().replace(/\s+/g, " ") ?? ""
  return {
    path,
    filter,
    request_id: requestId,
    display_number: displayPattern.test(display) ? display : null,
    user_agent: agent === "" ? null : agent.slice(0, 240),
  }
}

/** Small read-only line. Leaves the user agent out of the dialog. */
export function feedbackContextSummary(input: FeedbackContextInput): string {
  const stored = storedFeedbackContext(input, null)
  const filterLabel = stored.filter === "mine" ? "My jobs" : "All jobs"
  const card = stored.display_number ? ` · ${stored.display_number}` : ""
  return `${stored.path} · ${filterLabel}${card}`
}

export function feedbackNoticeRecipients(ownerEmails: readonly string[]): string[] {
  const seen = new Set<string>()
  const recipients: string[] = []
  for (const raw of [FEEDBACK_NOTICE_EMAIL, ...ownerEmails]) {
    const email = raw.trim()
    const key = email.toLowerCase()
    if (!emailPattern.test(email) || seen.has(key)) {
      continue
    }
    seen.add(key)
    recipients.push(email)
  }
  return recipients
}

export function feedbackNoticeText(input: {
  kind: FeedbackKind
  body: string
  submitterName: string
  summary: string
  userAgent: string | null
}): { subject: string; text: string } {
  const label = feedbackKindLabel(input.kind)
  const lines = [
    `${input.submitterName} sent a ${label.toLowerCase()}.`,
    "",
    input.body.trim(),
    "",
    `Board: ${input.summary}`,
  ]
  if (input.userAgent) {
    lines.push(`Device: ${input.userAgent}`)
  }
  return {
    subject: `LSP note: ${label}`,
    text: lines.join("\n"),
  }
}
