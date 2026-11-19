import { haversineMiles } from "@/lib/board-rules"

export const CLOSE_PATHS = [
  { id: "easy", label: "Easy repair" },
  { id: "parts", label: "Needs parts" },
  { id: "estimate", label: "Needs estimate" },
  { id: "one_off", label: "One-off" },
] as const

export type ClosePath = (typeof CLOSE_PATHS)[number]["id"]

export const ATTEMPT_REASONS = [
  { id: "no_access", label: "No access" },
  { id: "tenant_refused", label: "Tenant refused" },
  { id: "lockbox", label: "Lockbox problem" },
  { id: "no_escort", label: "No escort" },
  { id: "other", label: "Other" },
] as const

export type AttemptReason = (typeof ATTEMPT_REASONS)[number]["id"]

export type SignoffRule = "none" | "note_only" | "walkthrough_signature" | "photos"

export type VisitStatus =
  | "planned"
  | "en_route"
  | "on_site"
  | "working"
  | "closed"
  | "attempt"
  | "cancelled"

export type Readings = {
  superheat: string
  subcool: string
  deltaT: string
  suction: string
  liquid: string
}

export const emptyReadings = (): Readings => ({
  superheat: "",
  subcool: "",
  deltaT: "",
  suction: "",
  liquid: "",
})

export function isClosePath(value: string | null | undefined): value is ClosePath {
  return CLOSE_PATHS.some((path) => path.id === value)
}

export function isAttemptReason(value: string | null | undefined): value is AttemptReason {
  return ATTEMPT_REASONS.some((reason) => reason.id === value)
}

export function isVisitStatus(value: string | null | undefined): value is VisitStatus {
  return (
    value === "planned" ||
    value === "en_route" ||
    value === "on_site" ||
    value === "working" ||
    value === "closed" ||
    value === "attempt" ||
    value === "cancelled"
  )
}

export function isSignoffRule(value: string | null | undefined): value is SignoffRule {
  return (
    value === "none" ||
    value === "note_only" ||
    value === "walkthrough_signature" ||
    value === "photos"
  )
}

export function formatDollars(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100)
}

const METERS_PER_MILE = 1609.344

/** True when the tech is inside the property fence. Radius is meters. */
export function withinGeofence(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
  radiusMeters: number,
): boolean {
  if (
    !Number.isFinite(fromLat) ||
    !Number.isFinite(fromLng) ||
    !Number.isFinite(toLat) ||
    !Number.isFinite(toLng) ||
    !Number.isFinite(radiusMeters) ||
    radiusMeters <= 0
  ) {
    return false
  }
  return haversineMiles(fromLat, fromLng, toLat, toLng) * METERS_PER_MILE <= radiusMeters
}

export type CloseChecklistInput = {
  path: ClosePath | null
  note: string
  model: string
  serial: string
  bundleId: string | null
  requiresModelSerial: boolean
  oneShot: boolean
  signoff: SignoffRule
  signoffName: string
  hasSignature: boolean
  photoCount: number
  partDescription: string
}

/** What still blocks Close. A nameplate photo never fills in model or serial. */
export function closeGaps(input: CloseChecklistInput): string[] {
  const gaps: string[] = []
  if (!input.path) {
    gaps.push("Pick a path.")
  }
  // Optional on a simple repair; required for parts, estimate and one-off.
  if (input.note.trim() === "" && input.path !== "easy") {
    gaps.push("Write a note.")
  }
  if (input.path === "easy" || input.path === "parts") {
    if (!input.bundleId) {
      gaps.push("Pick a repair.")
    }
  }
  if (input.path === "easy" && input.oneShot) {
    gaps.push("That repair needs a part. Choose Needs parts.")
  }
  if (
    input.path === "parts" ||
    (input.requiresModelSerial && (input.path === "easy" || input.path === "estimate" || input.path === "one_off"))
  ) {
    if (input.model.trim() === "" || input.serial.trim() === "") {
      gaps.push("Type the model and the serial. A nameplate photo is not enough.")
    }
  }
  if (input.path === "parts" && input.partDescription.trim() === "") {
    gaps.push("Say what part you need.")
  }
  if (input.signoff === "walkthrough_signature") {
    if (input.signoffName.trim() === "") {
      gaps.push("Sign-off needs a name.")
    }
    if (!input.hasSignature) {
      gaps.push("Sign-off needs a signature.")
    }
  }
  if (input.signoff === "photos" && input.photoCount < 1) {
    gaps.push("This property needs a photo.")
  }
  return gaps
}

export function attemptGaps(reason: AttemptReason | null, note: string): string[] {
  const gaps: string[] = []
  if (!reason) {
    gaps.push("Pick why you could not get in.")
  }
  if (note.trim() === "") {
    gaps.push("Write what happened.")
  }
  return gaps
}

/** Parts path cannot leave the visit until model and serial are typed. */
export function departureBlocked(path: ClosePath | null, model: string, serial: string): boolean {
  return path === "parts" && (model.trim() === "" || serial.trim() === "")
}

export function pathAfterBundle(path: ClosePath | null, oneShot: boolean): ClosePath | null {
  if (oneShot) {
    return "parts"
  }
  return path
}

export type SyncTone = "synced" | "pending" | "offline" | "conflict"

export function syncLabel(input: {
  offline: boolean
  queued: number
  conflict: boolean
}): { tone: SyncTone; label: string } {
  if (input.conflict) {
    return { tone: "conflict", label: "Needs a look" }
  }
  if (input.offline) {
    return { tone: "offline", label: input.queued > 0 ? `Offline · ${input.queued} pending` : "Offline" }
  }
  if (input.queued > 0) {
    return { tone: "pending", label: `${input.queued} pending` }
  }
  return { tone: "synced", label: "Synced" }
}

export function isTransportFailure(message: string): boolean {
  return /failed to fetch|network|load failed|offline|timeout|aborted/i.test(message)
}

export type VisitCommand =
  | {
      id: string
      requestId: string
      seenAt: string | null
      kind: "on_site"
      source: "tap" | "gps"
      lat: number | null
      lng: number | null
    }
  | { id: string; requestId: string; seenAt: string | null; kind: "start_job" }
  | { id: string; requestId: string; seenAt: string | null; kind: "select_bundle"; bundleId: string }
  | { id: string; requestId: string; seenAt: string | null; kind: "add_bundle"; bundleId: string }
  | { id: string; requestId: string; seenAt: string | null; kind: "remove_bundle"; selectionId: string }
  | {
      id: string
      requestId: string
      seenAt: string | null
      kind: "save_parts"
      description: string
      supplierId: string | null
      supplierContact: string
      orderNumber: string
      expectedDelivery: string | null
    }
  | {
      id: string
      requestId: string
      seenAt: string | null
      kind: "attempt"
      reason: AttemptReason
      note: string
    }
  | {
      id: string
      requestId: string
      seenAt: string | null
      kind: "close"
      path: ClosePath
      note: string
      model: string
      serial: string
      equipmentSize: string
      readings: Readings
      signoffName: string
      oneOffNarrative: string
      materials: string
      partDescription: string
      supplierId: string | null
      supplierContact: string
      orderNumber: string
      expectedDelivery: string | null
      clientDraftId: string
    }
  | { id: string; requestId: string; seenAt: string | null; kind: "part_in_hand"; partsOrderId: string }
  | {
      id: string
      requestId: string
      seenAt: string | null
      kind: "attach"
      attachKind: "photo" | "nameplate" | "signature"
      storagePath: string
      caption: string | null
    }

export type FlushResult = "ok" | "conflict" | "retry" | "drop"

/** Apply one flush result to the front of the queue. Conflict drops the rest of that call. */
export function reduceQueue(
  items: readonly VisitCommand[],
  result: FlushResult,
): { items: VisitCommand[]; stop: boolean } {
  if (items.length === 0) {
    return { items: [], stop: true }
  }
  const [head, ...rest] = items
  if (result === "ok" || result === "drop") {
    return { items: rest, stop: false }
  }
  if (result === "conflict") {
    return {
      items: rest.filter((item) => item.requestId !== head.requestId),
      stop: false,
    }
  }
  return { items: [head, ...rest], stop: true }
}

export type VisitDraft = {
  requestId: string
  clientDraftId: string
  phase: "local_draft" | "queued"
  updatedAt: string
  step: "diagnose" | "bundle" | "parts" | "close" | null
  optimisticStatus: VisitStatus | null
  path: ClosePath | null
  model: string
  serial: string
  equipmentSize: string
  note: string
  readings: Readings
  signoffName: string
  signatureDataUrl: string | null
  oneOffNarrative: string
  materials: string
  partDescription: string
  supplierId: string | null
  supplierContact: string
  orderNumber: string
  expectedDelivery: string
  ownerWillFinish: boolean
  bundleId: string | null
  photoCount: number
  conflict: boolean
}

export function emptyDraft(requestId: string, clientDraftId: string): VisitDraft {
  return {
    requestId,
    clientDraftId,
    phase: "local_draft",
    updatedAt: new Date().toISOString(),
    step: null,
    optimisticStatus: null,
    path: null,
    model: "",
    serial: "",
    equipmentSize: "",
    note: "",
    readings: emptyReadings(),
    signoffName: "",
    signatureDataUrl: null,
    oneOffNarrative: "",
    materials: "",
    partDescription: "",
    supplierId: null,
    supplierContact: "",
    orderNumber: "",
    expectedDelivery: "",
    ownerWillFinish: false,
    bundleId: null,
    photoCount: 0,
    conflict: false,
  }
}

const QUEUE_KEY = "lsp.visitQueue.v1"
const DRAFT_PREFIX = "lsp.visitDraft.v1."
const EMPTY_VISIT_QUEUE: VisitCommand[] = []

const queueListeners = new Set<() => void>()
let queueCacheRaw = ""
let queueCache: VisitCommand[] = EMPTY_VISIT_QUEUE
const draftCacheRaw = new Map<string, string>()
const draftCache = new Map<string, VisitDraft | null>()

function storage(): Storage | null {
  if (typeof window === "undefined") {
    return null
  }
  return window.localStorage
}

export function readVisitQueue(): VisitCommand[] {
  const store = storage()
  if (!store) {
    return EMPTY_VISIT_QUEUE
  }
  try {
    const raw = store.getItem(QUEUE_KEY) ?? ""
    if (raw === queueCacheRaw) {
      return queueCache
    }
    queueCacheRaw = raw
    queueCache = raw ? parseQueue(raw) : EMPTY_VISIT_QUEUE
    return queueCache
  } catch {
    queueCacheRaw = ""
    queueCache = EMPTY_VISIT_QUEUE
    return queueCache
  }
}

export function writeVisitQueue(items: VisitCommand[]) {
  const store = storage()
  if (!store) {
    return
  }
  const raw = JSON.stringify(items)
  store.setItem(QUEUE_KEY, raw)
  queueCacheRaw = raw
  queueCache = items
  queueListeners.forEach((listener) => listener())
}

export function subscribeVisitQueue(listener: () => void) {
  queueListeners.add(listener)
  return () => {
    queueListeners.delete(listener)
  }
}

export function getVisitQueueServerSnapshot(): VisitCommand[] {
  return EMPTY_VISIT_QUEUE
}

export function enqueueVisitCommand(command: VisitCommand) {
  const current = readVisitQueue()
  writeVisitQueue([...current, command])
}

export function readVisitDraft(requestId: string): VisitDraft | null {
  const store = storage()
  if (!store) {
    return null
  }
  try {
    const raw = store.getItem(DRAFT_PREFIX + requestId) ?? ""
    if (draftCacheRaw.get(requestId) === raw) {
      return draftCache.get(requestId) ?? null
    }
    const draft = draftFromRaw(raw)
    draftCacheRaw.set(requestId, raw)
    draftCache.set(requestId, draft)
    return draft
  } catch {
    draftCacheRaw.set(requestId, "")
    draftCache.set(requestId, null)
    return null
  }
}

export function writeVisitDraft(draft: VisitDraft) {
  const store = storage()
  if (!store) {
    return
  }
  const next = { ...draft, updatedAt: new Date().toISOString() }
  const raw = JSON.stringify(next)
  store.setItem(DRAFT_PREFIX + draft.requestId, raw)
  draftCacheRaw.set(draft.requestId, raw)
  draftCache.set(draft.requestId, next)
  queueListeners.forEach((listener) => listener())
}

const PHOTO_PREFIX = "lsp.visitPhotos.v1."

export function readVisitPhotos(requestId: string): string[] {
  const store = storage()
  if (!store) {
    return []
  }
  try {
    const raw = store.getItem(PHOTO_PREFIX + requestId)
    if (!raw) {
      return []
    }
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : []
  } catch {
    return []
  }
}

export function writeVisitPhotos(requestId: string, photos: string[]): boolean {
  const store = storage()
  if (!store) {
    return false
  }
  try {
    store.setItem(PHOTO_PREFIX + requestId, JSON.stringify(photos))
    return true
  } catch {
    return false
  }
}

export function clearVisitPhotos(requestId: string) {
  storage()?.removeItem(PHOTO_PREFIX + requestId)
}

export function clearVisitDraft(requestId: string) {
  const store = storage()
  if (!store) {
    return
  }
  store.removeItem(DRAFT_PREFIX + requestId)
  store.removeItem(PHOTO_PREFIX + requestId)
  store.removeItem(PHOTO_PREFIX + requestId + ":nameplate")
  draftCacheRaw.set(requestId, "")
  draftCache.set(requestId, null)
  queueListeners.forEach((listener) => listener())
}

function draftFromRaw(raw: string): VisitDraft | null {
  if (!raw) {
    return null
  }
  const parsed = JSON.parse(raw) as unknown
  if (!isVisitDraft(parsed)) {
    return null
  }
  return {
    ...emptyDraft(parsed.requestId, parsed.clientDraftId),
    ...parsed,
    optimisticStatus: parsed.optimisticStatus ?? null,
  }
}

function parseQueue(raw: string): VisitCommand[] {
  if (!raw) {
    return []
  }
  const parsed = JSON.parse(raw) as unknown
  if (!Array.isArray(parsed)) {
    return []
  }
  return parsed.filter(isVisitCommand)
}

function isVisitCommand(value: unknown): value is VisitCommand {
  if (!value || typeof value !== "object") {
    return false
  }
  const item = value as { id?: unknown; requestId?: unknown; kind?: unknown }
  return typeof item.id === "string" && typeof item.requestId === "string" && typeof item.kind === "string"
}

function isVisitDraft(value: unknown): value is VisitDraft {
  if (!value || typeof value !== "object") {
    return false
  }
  const draft = value as Partial<VisitDraft>
  return typeof draft.requestId === "string" && typeof draft.clientDraftId === "string"
}

export function newCommandId(): string {
  return crypto.randomUUID()
}
