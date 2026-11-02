export const QUICK_ADD_SOURCES = [
  { id: "phone", label: "Phone" },
  { id: "text", label: "Text" },
  { id: "email", label: "Email" },
  { id: "dispatcher", label: "Dispatcher" },
  { id: "tech_direct", label: "Tech" },
  { id: "onsite", label: "On site" },
] as const

export type QuickAddSource = (typeof QUICK_ADD_SOURCES)[number]["id"]

export function isQuickAddSource(value: string): value is QuickAddSource {
  return QUICK_ADD_SOURCES.some((source) => source.id === value)
}

export type PickerContact = {
  id: string
  name: string
  customerId: string
  customerName: string
  phone: string | null
}

export type PickerProperty = {
  id: string
  name: string
  customerId: string
  customerName: string
  address: string
  residentMode: string | null
  residentNotes: string | null
}

export type PickerLink = {
  contactId: string
  propertyId: string
}

export type BoardCrewMember = {
  id: string
  fullName: string
  role: "owner" | "tech"
}

export type BoardCatalog = {
  contacts: PickerContact[]
  properties: PickerProperty[]
  links: PickerLink[]
  crew: BoardCrewMember[]
}

export const emptyCatalog: BoardCatalog = {
  contacts: [],
  properties: [],
  links: [],
  crew: [],
}

export type PropertyUnit = {
  id: string
  label: string
  recent: {
    issue: string
    status: string
    createdAt: string
  } | null
}

export type PendingQuickAdd = {
  clientId: string
  contactId: string
  propertyId: string
  unitId: string | null
  newUnitLabel: string | null
  issue: string
  source: QuickAddSource
  reportedByResident: boolean
  linkContact: boolean
  contactName: string
  propertyName: string
  unitLabel: string
  createdAt: string
}

const QUEUE_KEY = "lsp.quickAdd.v1"
const EMPTY_QUEUE: PendingQuickAdd[] = []
const queueListeners = new Set<() => void>()
let queueCacheRaw = ""
let queueCache: PendingQuickAdd[] = EMPTY_QUEUE

export function readQuickAddQueue(): PendingQuickAdd[] {
  if (typeof window === "undefined") {
    return EMPTY_QUEUE
  }
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY) ?? ""
    if (raw === queueCacheRaw) {
      return queueCache
    }
    queueCacheRaw = raw
    if (!raw) {
      queueCache = EMPTY_QUEUE
      return queueCache
    }
    const parsed = JSON.parse(raw) as unknown
    queueCache = Array.isArray(parsed) ? parsed.filter(isPendingQuickAdd) : EMPTY_QUEUE
    return queueCache
  } catch {
    queueCache = EMPTY_QUEUE
    return queueCache
  }
}

export function writeQuickAddQueue(items: PendingQuickAdd[]) {
  if (typeof window === "undefined") {
    return
  }
  const raw = JSON.stringify(items)
  window.localStorage.setItem(QUEUE_KEY, raw)
  queueCacheRaw = raw
  queueCache = items
  queueListeners.forEach((listener) => listener())
}

export function subscribeQuickAddQueue(listener: () => void) {
  queueListeners.add(listener)
  return () => {
    queueListeners.delete(listener)
  }
}

export function getQuickAddQueueServerSnapshot(): PendingQuickAdd[] {
  return EMPTY_QUEUE
}

function isPendingQuickAdd(value: unknown): value is PendingQuickAdd {
  if (!value || typeof value !== "object") {
    return false
  }
  const item = value as Partial<PendingQuickAdd>
  return (
    typeof item.clientId === "string" &&
    typeof item.contactId === "string" &&
    typeof item.propertyId === "string" &&
    typeof item.issue === "string" &&
    typeof item.source === "string" &&
    isQuickAddSource(item.source)
  )
}

export function propertiesForPicker(
  properties: readonly PickerProperty[],
  links: readonly PickerLink[],
  contact: PickerContact | null,
  showAll: boolean,
): PickerProperty[] {
  if (!contact) {
    return [...properties]
  }
  if (showAll) {
    return properties.filter((property) => property.customerId === contact.customerId)
  }
  const allowed = new Set(
    links.filter((link) => link.contactId === contact.id).map((link) => link.propertyId),
  )
  return properties.filter((property) => allowed.has(property.id))
}

export function contactsForPicker(
  contacts: readonly PickerContact[],
  links: readonly PickerLink[],
  property: PickerProperty | null,
  showAll: boolean,
): PickerContact[] {
  if (!property) {
    return [...contacts]
  }
  if (showAll) {
    return contacts.filter((contact) => contact.customerId === property.customerId)
  }
  const allowed = new Set(
    links.filter((link) => link.propertyId === property.id).map((link) => link.contactId),
  )
  return contacts.filter((contact) => allowed.has(contact.id))
}
