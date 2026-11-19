"use client"

import { useEffect, useMemo, useState } from "react"

import { loadPropertyUnits, createQuickAdd } from "@/app/actions/board"
import { Sheet } from "@/components/board/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { isBoardStatus } from "@/lib/board"
import {
  duplicateWarningText,
  matchesQuery,
  pairNeedsLink,
  quickAddMissing,
  type QuickAddField,
} from "@/lib/board-rules"
import {
  contactsForPicker,
  defaultContactFor,
  QUICK_ADD_DEFAULT_REPORTED_BY_RESIDENT,
  QUICK_ADD_DEFAULT_SOURCE,
  type BoardCatalog,
  type PendingQuickAdd,
  type PropertyUnit,
} from "@/lib/quick-add"

export function QuickAddSheet({
  open,
  catalog,
  onClose,
  onCreated,
  onQueued,
}: {
  open: boolean
  catalog: BoardCatalog
  onClose: () => void
  onCreated: (message: string, requestId: string) => void
  onQueued: (item: PendingQuickAdd) => void
}) {
  if (!open) {
    return null
  }
  return (
    <QuickAddForm catalog={catalog} onClose={onClose} onCreated={onCreated} onQueued={onQueued} />
  )
}

function QuickAddForm({
  catalog,
  onClose,
  onCreated,
  onQueued,
}: {
  catalog: BoardCatalog
  onClose: () => void
  onCreated: (message: string, requestId: string) => void
  onQueued: (item: PendingQuickAdd) => void
}) {
  // Property first. The contact fills in from the property; changing it is optional.
  const [propertyId, setPropertyId] = useState("")
  const [contactOverride, setContactOverride] = useState("")
  const [changingContact, setChangingContact] = useState(false)
  const [propertyQuery, setPropertyQuery] = useState("")
  const [unitText, setUnitText] = useState("")
  const [unitId, setUnitId] = useState<string | null>(null)
  const [units, setUnits] = useState<PropertyUnit[]>([])
  const [unitsMessage, setUnitsMessage] = useState<string | null>(null)
  const [issue, setIssue] = useState("")
  const [attempted, setAttempted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [notedAt, setNotedAt] = useState<number | null>(null)

  useEffect(() => {
    if (!propertyId) {
      return
    }
    let cancelled = false
    loadPropertyUnits(propertyId).then((result) => {
      if (cancelled) {
        return
      }
      if (!result.ok) {
        setUnits([])
        setUnitsMessage(result.message)
        return
      }
      setUnits(result.data)
      setUnitsMessage(null)
    })
    return () => {
      cancelled = true
    }
  }, [propertyId])

  const property = catalog.properties.find((item) => item.id === propertyId) ?? null
  const contact =
    catalog.contacts.find((item) => item.id === contactOverride) ??
    (propertyId
      ? defaultContactFor(propertyId, catalog.contacts, catalog.links, catalog.properties)
      : null)
  const contactId = contact?.id ?? ""
  const contactChoices = useMemo(
    () => (property ? contactsForPicker(catalog.contacts, catalog.links, property, true) : []),
    [catalog.contacts, catalog.links, property],
  )
  const propertyChoices = useMemo(
    () =>
      [...catalog.properties]
        .sort((a, b) => a.name.localeCompare(b.name))
        .filter((item) => matchesQuery(`${item.name} ${item.address}`, propertyQuery)),
    [catalog.properties, propertyQuery],
  )

  const missing = attempted
    ? quickAddMissing({ contactId, propertyId, unitId, unitText, issue })
    : []
  const needsLink = pairNeedsLink(catalog.links, contactId, propertyId)
  const selectedUnit = units.find((unit) => unit.id === unitId) ?? null
  const recent = selectedUnit?.recent
  const warning =
    selectedUnit && recent && notedAt !== null && isBoardStatus(recent.status)
      ? duplicateWarningText({
          unitLabel: selectedUnit.label,
          issue: recent.issue,
          status: recent.status,
          createdAt: recent.createdAt,
          nowMs: notedAt,
        })
      : null
  const unitChoices = units.filter((unit) => matchesQuery(unit.label, unitText)).slice(0, 6)

  async function save(linkContact: boolean) {
    setChangingContact(false)
    const gaps = quickAddMissing({
      contactId,
      propertyId,
      unitId,
      unitText,
      issue,
    })
    setAttempted(true)
    setError(null)
    if (gaps.length > 0) {
      return
    }

    const payload = {
      contactId,
      propertyId,
      unitId,
      newUnitLabel: unitId ? null : unitText.trim(),
      issue: issue.trim(),
      source: QUICK_ADD_DEFAULT_SOURCE,
      reportedByResident: QUICK_ADD_DEFAULT_REPORTED_BY_RESIDENT,
      // A contact picked for a property they aren't linked to gets linked.
      linkContact: needsLink || linkContact,
      contactName: contact?.name ?? "Contact",
      propertyName: property?.name ?? "Property",
      unitLabel: selectedUnit?.label ?? unitText.trim(),
    }

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      onQueued({
        clientId: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        ...payload,
      })
      onClose()
      return
    }

    setSaving(true)
    try {
      const result = await createQuickAdd(payload)
      if (!result.ok) {
        setError(result.message)
        setSaving(false)
        return
      }
      const duplicateNote = result.data.duplicate
        ? ` ${duplicateWarningText({
            unitLabel: payload.unitLabel,
            issue: result.data.duplicate.issue,
            status: result.data.duplicate.status,
            createdAt: result.data.duplicate.createdAt,
            nowMs: currentTimeMs(),
          })}`
        : ""
      onCreated(`Saved ${result.data.displayNumber}.${duplicateNote}`, result.data.id)
      onClose()
    } catch {
      onQueued({
        clientId: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        ...payload,
      })
      onClose()
    }
  }

  return (
    <Sheet open title="Quick Add" onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          void save(false)
        }}
      >
        {property ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
            <div className="min-w-0">
              <p className="text-[13px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
                Property
              </p>
              <p className="truncate text-lg font-bold">{property.name}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="field"
              onClick={() => {
                setPropertyId("")
                setContactOverride("")
                setChangingContact(false)
                setUnitId(null)
                setUnitText("")
                setUnits([])
              }}
            >
              Change
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Label htmlFor="quick-add-property">Property</Label>
            <Input
              id="quick-add-property"
              value={propertyQuery}
              aria-invalid={missing.includes("property")}
              placeholder="Type to narrow the list"
              className="h-12 text-base"
              onChange={(event) => setPropertyQuery(event.target.value)}
            />
            <ul className="max-h-[50dvh] divide-y divide-border overflow-y-auto rounded-xl border border-border bg-card">
              {propertyChoices.length === 0 ? (
                <li className="px-4 py-3 text-sm text-muted-foreground">No properties match.</li>
              ) : (
                propertyChoices.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setPropertyId(item.id)
                        setPropertyQuery("")
                        setContactOverride("")
                        setUnitId(null)
                        setUnitText("")
                        setUnits([])
                      }}
                      className="flex min-h-12 w-full flex-col items-start px-4 py-2 text-left hover:bg-muted"
                    >
                      <span className="text-[16px] font-semibold">{item.name}</span>
                      <span className="text-[13px] text-muted-foreground">{item.address}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        )}

        {property ? (
          changingContact ? (
            <div className="flex flex-col gap-2">
              <Label>Contact</Label>
              <ul className="max-h-60 divide-y divide-border overflow-y-auto rounded-xl border border-border bg-card">
                {contactChoices.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setContactOverride(item.id)
                        setChangingContact(false)
                      }}
                      className="flex min-h-12 w-full items-center px-4 py-2 text-left text-[16px] hover:bg-muted"
                    >
                      {item.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-[15px] text-muted-foreground">
              {contact ? (
                <>
                  Contact: <span className="font-semibold text-foreground">{contact.name}</span>{" "}
                  {contactChoices.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => setChangingContact(true)}
                      className="underline"
                    >
                      change
                    </button>
                  ) : null}
                </>
              ) : (
                "No contact on file for this property. Add one in Setup → Contacts."
              )}
            </p>
          )
        ) : null}

        {property ? (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor="quick-add-unit">Unit</Label>
              <Input
                id="quick-add-unit"
                value={unitText}
                aria-invalid={missing.includes("unit")}
                placeholder="Recent units first, or type a new one"
                className="h-12 min-h-12 text-base"
                onChange={(event) => {
                  const value = event.target.value
                  setUnitText(value)
                  const match = units.find(
                    (unit) => unit.label.toLowerCase() === value.trim().toLowerCase(),
                  )
                  setUnitId(match?.id ?? null)
                  setNotedAt(currentTimeMs())
                }}
              />
              {unitsMessage ? <p className="text-sm text-destructive">{unitsMessage}</p> : null}
              {unitChoices.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {unitChoices.map((unit) => (
                    <Button
                      key={unit.id}
                      type="button"
                      variant={unit.id === unitId ? "default" : "outline"}
                      size="field"
                      className="justify-start"
                      onClick={() => {
                        setUnitId(unit.id)
                        setUnitText(unit.label)
                        setNotedAt(currentTimeMs())
                      }}
                    >
                      {unit.label}
                      {unit.recent ? " · recent" : ""}
                    </Button>
                  ))}
                </div>
              ) : null}
              {warning ? (
                <p
                  role="status"
                  className="rounded-lg border border-free-foreground/30 bg-free px-3 py-3 text-sm leading-6 text-free-foreground"
                >
                  {warning}. The call will still be saved.
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="quick-add-issue">Issue</Label>
              <Input
                id="quick-add-issue"
                value={issue}
                aria-invalid={missing.includes("issue")}
                maxLength={200}
                placeholder="One line, such as no heat"
                className="h-12 min-h-12 text-base"
                onChange={(event) => setIssue(event.target.value)}
              />
            </div>
          </>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm leading-6 text-destructive">
            {error}
          </p>
        ) : null}
        {missing.length > 0 ? (
          <p role="alert" className="text-sm leading-6 text-destructive">
            Fill {missing.map(fieldLabel).join(", ")}.
          </p>
        ) : null}

        {property ? (
          <Button type="submit" size="field" disabled={saving || !contact} className="h-14 text-lg">
            {saving ? "Saving…" : "Save call"}
          </Button>
        ) : null}
      </form>
    </Sheet>
  )
}

function fieldLabel(field: QuickAddField): string {
  if (field === "contact") {
    return "contact"
  }
  if (field === "property") {
    return "property"
  }
  if (field === "unit") {
    return "unit"
  }
  return "issue"
}

/** Read the clock in event handlers only (kept out of render). */
function currentTimeMs(): number {
  return Date.now()
}
