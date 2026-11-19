"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import {
  findAddressOnMap,
  saveProperty,
  setPropertyActive,
} from "@/app/actions/setup"
import { PinMap } from "@/components/setup/pin-map"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { SetupCounty, SetupCustomer, SetupProperty } from "@/lib/setup-data"
import { formatRate, type PropertyInput } from "@/lib/setup"

type Notice = { tone: "ok" | "error"; text: string } | null

function toInput(p: SetupProperty | null, customers: SetupCustomer[]): PropertyInput {
  const firstActive = customers.find((c) => c.active)
  return {
    customerId: p?.customerId ?? firstActive?.id ?? "",
    name: p?.name ?? "",
    addressLine1: p?.addressLine1 ?? "",
    city: p?.city ?? "",
    state: p?.state ?? "NC",
    zip: p?.zip ?? "",
    county: p?.county ?? "",
    lat: p?.lat?.toString() ?? "",
    lng: p?.lng?.toString() ?? "",
    geofenceRadiusM: String(p?.geofenceRadiusM ?? 150),
    siteAccessText: p?.siteAccessText ?? "",
    lockboxInfo: p?.lockboxInfo ?? "",
  }
}

const textareaClass =
  "min-h-24 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
const selectClass =
  "h-11 w-full rounded-lg border border-input bg-card px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"

export function PropertyEditor({
  property,
  counties,
  customers,
}: {
  property: SetupProperty | null
  counties: SetupCounty[]
  customers: SetupCustomer[]
}) {
  const router = useRouter()
  const [form, setForm] = useState<PropertyInput>(() => toInput(property, customers))
  const [notice, setNotice] = useState<Notice>(null)
  const [focus, setFocus] = useState(0)
  const [saving, startSave] = useTransition()
  const [finding, startFind] = useTransition()
  const [retiring, startRetire] = useTransition()

  const isNew = property === null
  const set = (key: keyof PropertyInput) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value }))
    setNotice(null)
  }

  const lat = form.lat.trim() === "" ? null : Number(form.lat)
  const lng = form.lng.trim() === "" ? null : Number(form.lng)
  const radius = Number(form.geofenceRadiusM) || 150
  const countyRate = counties.find((c) => c.county === form.county)?.rateBps
  const savedCountyRate = property?.county
    ? counties.find((c) => c.county === property.county)?.rateBps
    : undefined
  const fullAddress = `${form.addressLine1}, ${form.city}, ${form.state} ${form.zip}`

  function movePin(newLat: number, newLng: number) {
    setForm((f) => ({ ...f, lat: newLat.toFixed(6), lng: newLng.toFixed(6) }))
    setNotice(null)
  }

  function find() {
    startFind(async () => {
      const result = await findAddressOnMap(fullAddress)
      if (!result.ok) {
        setNotice({ tone: "error", text: result.message })
        return
      }
      movePin(result.value.lat, result.value.lng)
      setFocus((n) => n + 1)
      setNotice({
        tone: "ok",
        text: "Found it nearby. Drag the pin onto the building, then Save.",
      })
    })
  }

  function save() {
    startSave(async () => {
      const result = await saveProperty(property?.id ?? null, form)
      if (!result.ok) {
        setNotice({ tone: "error", text: result.message })
        return
      }
      setNotice({ tone: "ok", text: "Saved." })
      if (isNew) {
        router.push(`/setup/properties/${result.value.id}`)
      } else {
        router.refresh()
      }
    })
  }

  function toggleActive() {
    if (!property) return
    startRetire(async () => {
      const result = await setPropertyActive(property.id, !property.active)
      if (!result.ok) {
        setNotice({ tone: "error", text: result.message })
        return
      }
      setNotice({ tone: "ok", text: property.active ? "Retired." : "Back in service." })
      router.refresh()
    })
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
      className="flex flex-col gap-5"
    >
      <div className="flex flex-wrap items-start gap-3">
        <Link
          href="/setup/properties"
          className="flex min-h-11 items-center rounded-lg border border-border px-3 text-sm lg:hidden"
        >
          ← All properties
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-3xl leading-tight font-semibold tracking-wide">
            {isNew ? "New property" : property.name}
          </h1>
          {property && !property.active ? (
            <p className="text-sm font-medium text-destructive">
              Retired. It doesn&apos;t appear on the Board or in Quick Add.
            </p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
          <h2 className="font-display text-xl tracking-wide">Where it is</h2>
          <Field id="name" label="Property name">
            <Input id="name" value={form.name} onChange={(e) => set("name")(e.target.value)} className="h-11" required />
          </Field>
          <Field id="customer" label="Customer">
            <select
              id="customer"
              value={form.customerId}
              onChange={(e) => set("customerId")(e.target.value)}
              className={selectClass}
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.active ? "" : " (retired)"}
                </option>
              ))}
            </select>
          </Field>
          <Field id="address" label="Street address">
            <Input id="address" value={form.addressLine1} onChange={(e) => set("addressLine1")(e.target.value)} className="h-11" required />
          </Field>
          <div className="grid grid-cols-[1fr_4.5rem_6.5rem] gap-2">
            <Field id="city" label="City">
              <Input id="city" value={form.city} onChange={(e) => set("city")(e.target.value)} className="h-11" required />
            </Field>
            <Field id="state" label="State">
              <Input id="state" value={form.state} maxLength={2} onChange={(e) => set("state")(e.target.value)} className="h-11 uppercase" />
            </Field>
            <Field id="zip" label="Zip">
              <Input id="zip" value={form.zip} inputMode="numeric" maxLength={5} onChange={(e) => set("zip")(e.target.value)} className="h-11" required />
            </Field>
          </div>
          <Field id="county" label="County (sets the sales tax)">
            <select
              id="county"
              value={form.county}
              onChange={(e) => set("county")(e.target.value)}
              className={selectClass}
            >
              <option value="">Pick a county</option>
              {counties.map((c) => (
                <option key={c.county} value={c.county}>
                  {c.county} · {formatRate(c.rateBps)}
                </option>
              ))}
            </select>
          </Field>
          <p className="-mt-2 text-sm text-muted-foreground">
            {countyRate !== undefined
              ? `Invoices here charge ${formatRate(countyRate)} sales tax.`
              : "No county yet, so invoices use the property's saved rate."}
            {property && form.county !== (property.county ?? "") && savedCountyRate !== countyRate
              ? " Changes when you Save."
              : ""}
          </p>
        </section>

        <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-xl tracking-wide">Map pin</h2>
            <Button type="button" variant="outline" size="lg" onClick={find} disabled={finding}>
              {finding ? "Finding…" : "Find address on map"}
            </Button>
          </div>
          <PinMap lat={lat} lng={lng} radiusM={radius} focus={focus} onMove={movePin} />
          <p className="text-sm text-muted-foreground">
            {lat === null
              ? "No pin yet. Tap Find, or tap the map, then drag the pin onto the building."
              : "Drag the pin onto the building. The circle is where the app counts the tech as arrived."}
          </p>
          <div className="grid grid-cols-[1fr_1fr_7rem] gap-2">
            <Field id="lat" label="Latitude">
              <Input id="lat" value={form.lat} inputMode="decimal" onChange={(e) => set("lat")(e.target.value)} className="h-10 tabular-nums" />
            </Field>
            <Field id="lng" label="Longitude">
              <Input id="lng" value={form.lng} inputMode="decimal" onChange={(e) => set("lng")(e.target.value)} className="h-10 tabular-nums" />
            </Field>
            <Field id="radius" label="Arrival (m)">
              <Input id="radius" value={form.geofenceRadiusM} inputMode="numeric" onChange={(e) => set("geofenceRadiusM")(e.target.value)} className="h-10 tabular-nums" />
            </Field>
          </div>
          {lat !== null ? (
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, lat: "", lng: "" }))}
              className="self-start text-sm text-muted-foreground underline"
            >
              Remove pin
            </button>
          ) : null}
        </section>

        <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 lg:col-span-2">
          <h2 className="font-display text-xl tracking-wide">Getting in</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Field id="access" label="Access notes (gate code, office hours, where to park)">
              <textarea id="access" value={form.siteAccessText} onChange={(e) => set("siteAccessText")(e.target.value)} className={textareaClass} />
            </Field>
            <Field id="lockbox" label="Lockbox / keys">
              <textarea id="lockbox" value={form.lockboxInfo} onChange={(e) => set("lockboxInfo")(e.target.value)} className={textareaClass} />
            </Field>
          </div>
        </section>
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
        <Button type="submit" size="field" disabled={saving} className="min-w-32">
          {saving ? "Saving…" : isNew ? "Add property" : "Save"}
        </Button>
        {notice ? (
          <p
            role={notice.tone === "error" ? "alert" : "status"}
            className={"text-sm font-medium " + (notice.tone === "error" ? "text-destructive" : "text-synced")}
          >
            {notice.text}
          </p>
        ) : null}
        {property ? (
          <Button
            type="button"
            variant={property.active ? "destructive" : "outline"}
            size="field"
            onClick={toggleActive}
            disabled={retiring}
            className="ml-auto"
          >
            {retiring ? "…" : property.active ? "Retire property" : "Put back in service"}
          </Button>
        ) : null}
      </div>
    </form>
  )
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  )
}
