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
  residentRuleText,
  type QuickAddField,
} from "@/lib/board-rules"
import {
  contactsForPicker,
  isQuickAddSource,
  propertiesForPicker,
  QUICK_ADD_SOURCES,
  type BoardCatalog,
  type PendingQuickAdd,
  type PropertyUnit,
  type QuickAddSource,
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
  onCreated: (message: string) => void
  onQueued: (item: PendingQuickAdd) => void
}) {
  if (!open) {
    return null
  }
  return (
    <QuickAddForm
      catalog={catalog}
      onClose={onClose}
      onCreated={onCreated}
      onQueued={onQueued}
    />
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
  onCreated: (message: string) => void
  onQueued: (item: PendingQuickAdd) => void
}) {
  const [contactId, setContactId] = useState("")
  const [propertyId, setPropertyId] = useState("")
  const [showAllContacts, setShowAllContacts] = useState(false)
  const [showAllProperties, setShowAllProperties] = useState(false)
  const [contactQuery, setContactQuery] = useState("")
  const [propertyQuery, setPropertyQuery] = useState("")
  const [unitText, setUnitText] = useState("")
  const [unitId, setUnitId] = useState<string | null>(null)
  const [units, setUnits] = useState<PropertyUnit[]>([])
  const [unitsMessage, setUnitsMessage] = useState<string | null>(null)
  const [issue, setIssue] = useState("")
  const [source, setSource] = useState<QuickAddSource>("phone")
  const [resident, setResident] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [linkPrompt, setLinkPrompt] = useState(false)
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

  const contact = catalog.contacts.find((item) => item.id === contactId) ?? null
  const property = catalog.properties.find((item) => item.id === propertyId) ?? null
  const contactChoices = useMemo(
    () =>
      contactsForPicker(catalog.contacts, catalog.links, property, showAllContacts).filter(
        (item) => matchesQuery(`${item.name} ${item.customerName}`, contactQuery),
      ),
    [catalog.contacts, catalog.links, property, showAllContacts, contactQuery],
  )
  const propertyChoices = useMemo(
    () =>
      propertiesForPicker(catalog.properties, catalog.links, contact, showAllProperties).filter(
        (item) => matchesQuery(`${item.name} ${item.customerName} ${item.address}`, propertyQuery),
      ),
    [catalog.properties, catalog.links, contact, showAllProperties, propertyQuery],
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
  const unitChoices = units
    .filter((unit) => matchesQuery(unit.label, unitText))
    .slice(0, 6)

  async function save(linkContact: boolean) {
    const gaps = quickAddMissing({ contactId, propertyId, unitId, unitText, issue })
    setAttempted(true)
    setError(null)
    if (gaps.length > 0) {
      return
    }
    if (needsLink && !linkContact) {
      setLinkPrompt(true)
      return
    }

    const payload = {
      contactId,
      propertyId,
      unitId,
      newUnitLabel: unitId ? null : unitText.trim(),
      issue: issue.trim(),
      source,
      reportedByResident: resident,
      linkContact: needsLink && linkContact,
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
            nowMs: Date.now(),
          })}`
        : ""
      onCreated(`Saved ${result.data.displayNumber}.${duplicateNote}`)
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
        <Picker
          label="Contact"
          invalid={missing.includes("contact")}
          query={contactQuery}
          onQuery={setContactQuery}
          selected={contact ? `${contact.name} · ${contact.customerName}` : null}
          onClear={() => {
            setContactId("")
            setShowAllProperties(false)
            setLinkPrompt(false)
          }}
          options={contactChoices.slice(0, 8).map((item) => ({
            id: item.id,
            title: item.name,
            detail: item.customerName,
          }))}
          more={Math.max(0, contactChoices.length - 8)}
          empty="No contacts match."
          onPick={(id) => {
            setContactId(id)
            setContactQuery("")
            setShowAllProperties(false)
            setLinkPrompt(false)
          }}
        />
        {contact && !showAllProperties ? (
          <Button
            type="button"
            variant="ghost"
            className="min-h-12 justify-start px-1"
            onClick={() => setShowAllProperties(true)}
          >
            Property isn&apos;t linked — show this customer&apos;s properties
          </Button>
        ) : null}

        <Picker
          label="Property"
          invalid={missing.includes("property")}
          query={propertyQuery}
          onQuery={setPropertyQuery}
          selected={property ? `${property.name} · ${property.customerName}` : null}
          onClear={() => {
            setPropertyId("")
            setUnitId(null)
            setUnitText("")
            setUnits([])
            setShowAllContacts(false)
            setLinkPrompt(false)
          }}
          options={propertyChoices.slice(0, 8).map((item) => ({
            id: item.id,
            title: item.name,
            detail: item.customerName,
          }))}
          more={Math.max(0, propertyChoices.length - 8)}
          empty={
            contact && !showAllProperties
              ? "No properties linked to this contact."
              : "No properties match."
          }
          onPick={(id) => {
            setPropertyId(id)
            setPropertyQuery("")
            setUnitId(null)
            setUnitText("")
            setUnits([])
            setShowAllContacts(false)
            setLinkPrompt(false)
          }}
        />
        {property && !showAllContacts ? (
          <Button
            type="button"
            variant="ghost"
            className="min-h-12 justify-start px-1"
            onClick={() => setShowAllContacts(true)}
          >
            Contact isn&apos;t linked — show this customer&apos;s contacts
          </Button>
        ) : null}

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
              setNotedAt(Date.now())
            }}
          />
          {unitsMessage ? (
            <p className="text-sm text-destructive">{unitsMessage}</p>
          ) : null}
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
                    setNotedAt(Date.now())
                  }}
                >
                  {unit.label}
                  {unit.recent ? " · recent" : ""}
                </Button>
              ))}
            </div>
          ) : null}
          {warning ? (
            <p role="status" className="rounded-lg border border-high/50 bg-high/15 px-3 py-3 text-sm leading-6">
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

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Source</legend>
          <div className="flex flex-wrap gap-2">
            {QUICK_ADD_SOURCES.map((item) => (
              <Button
                key={item.id}
                type="button"
                size="field"
                variant={source === item.id ? "default" : "outline"}
                aria-pressed={source === item.id}
                onClick={() => {
                  if (isQuickAddSource(item.id)) {
                    setSource(item.id)
                  }
                }}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </fieldset>

        <Button
          type="button"
          variant={resident ? "default" : "outline"}
          size="field"
          aria-pressed={resident}
          onClick={() => setResident((current) => !current)}
        >
          Resident reported
        </Button>
        {resident && property ? (
          <p className="text-sm leading-6">
            {residentRuleText(property.residentMode, property.residentNotes)}
          </p>
        ) : null}

        {linkPrompt ? (
          <div className="rounded-lg border border-border bg-card px-3 py-3">
            <p className="text-sm leading-6">
              Link {contact?.name ?? "this contact"} to {property?.name ?? "this property"}?
            </p>
            <div className="mt-3 flex gap-2">
              <Button type="button" size="field" disabled={saving} onClick={() => void save(true)}>
                Link and save
              </Button>
              <Button type="button" size="field" variant="outline" onClick={() => setLinkPrompt(false)}>
                Not now
              </Button>
            </div>
          </div>
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

        <Button type="submit" size="field" disabled={saving}>
          {saving ? "Saving…" : "Save call"}
        </Button>
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

function Picker({
  label,
  invalid,
  query,
  onQuery,
  selected,
  onClear,
  options,
  more,
  empty,
  onPick,
}: {
  label: string
  invalid: boolean
  query: string
  onQuery: (value: string) => void
  selected: string | null
  onClear: () => void
  options: { id: string; title: string; detail: string }[]
  more: number
  empty: string
  onPick: (id: string) => void
}) {
  const inputId = `quick-add-${label.toLowerCase()}`
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={inputId}>{label}</Label>
      {selected ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
          <p className="text-sm font-medium">{selected}</p>
          <Button type="button" variant="outline" size="field" onClick={onClear}>
            Change
          </Button>
        </div>
      ) : (
        <>
          <Input
            id={inputId}
            value={query}
            aria-invalid={invalid}
            placeholder={`Search ${label.toLowerCase()}`}
            className="h-12 min-h-12 text-base"
            onChange={(event) => onQuery(event.target.value)}
          />
          {options.length === 0 ? (
            <p className="text-sm text-muted-foreground">{empty}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {options.map((option) => (
                <Button
                  key={option.id}
                  type="button"
                  variant="outline"
                  size="field"
                  className="h-auto min-h-12 justify-start py-2 text-left"
                  onClick={() => onPick(option.id)}
                >
                  <span className="flex flex-col items-start">
                    <span>{option.title}</span>
                    {option.detail ? (
                      <span className="text-xs font-normal text-muted-foreground">{option.detail}</span>
                    ) : null}
                  </span>
                </Button>
              ))}
              {more > 0 ? (
                <p className="text-xs text-muted-foreground">Keep typing. {more} more.</p>
              ) : null}
            </div>
          )}
        </>
      )}
    </div>
  )
}
