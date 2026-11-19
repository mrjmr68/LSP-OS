export const QUICK_ADD_SOURCES = [
  { id: "phone", label: "Phone" },
  { id: "text", label: "Text" },
  { id: "email", label: "Email" },
  { id: "dispatcher", label: "Dispatcher" },
  { id: "tech_direct", label: "Tech" },
  { id: "onsite", label: "On site" },
] as const

export type QuickAddSource = (typeof QUICK_ADD_SOURCES)[number]["id"]

/** Quick Add does not ask. Phone is the intake tag for this form. */
export const QUICK_ADD_DEFAULT_SOURCE: QuickAddSource = "phone"

/** Quick Add does not ask. Matches the service_requests column default. */
export const QUICK_ADD_DEFAULT_REPORTED_BY_RESIDENT = false

/**
 * customer_contacts reaches customers two ways: customer_id, and
 * customers.billing_contact_id. A bare customers(...) embed is PGRST201,
 * which fails the whole Quick Add catalog.
 */
export const CONTACT_CUSTOMER_EMBED =
  "customers!customer_contacts_customer_id_fkey(name)"

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
  isPrimary?: boolean
}

/** The contact Quick Add fills in for a property: its primary link, any link, then anyone at the customer. */
export function defaultContactFor(
  propertyId: string,
  contacts: readonly PickerContact[],
  links: readonly PickerLink[],
  properties: readonly PickerProperty[],
): PickerContact | null {
  const linked = links.filter((l) => l.propertyId === propertyId)
  const pick =
    linked.find((l) => l.isPrimary) ?? linked.find((l) => contacts.some((c) => c.id === l.contactId))
  if (pick) {
    const found = contacts.find((c) => c.id === pick.contactId)
    if (found) return found
  }
  const customerId = properties.find((p) => p.id === propertyId)?.customerId
  return contacts.find((c) => c.customerId === customerId) ?? null
}

export type BoardCrewMember = {
  id: string
  fullName: string
  role: "owner" | "tech"
  /** Last reported position, if the app has one from the last few hours. */
  lastLat?: number | null
  lastLng?: number | null
  lastSeenMs?: number | null
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
