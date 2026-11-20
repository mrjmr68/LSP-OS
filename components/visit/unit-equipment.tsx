"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { readNameplate, saveEquipment, type EquipmentInput } from "@/app/actions/nameplate"
import {
  BRAND_GROUPS,
  REFRIGERANT_OPTIONS,
  TON_OPTIONS,
  matchBrand,
  matchRefrigerant,
} from "@/lib/nameplate"
import { prepareForReading } from "@/lib/photo-read"
import type { VisitEquipment } from "@/lib/visit-data"

type Side = "outdoor" | "indoor"
type Form = Omit<EquipmentInput, "unitId">

const KINDS: Record<Side, { value: Form["kind"]; label: string }[]> = {
  outdoor: [
    { value: "condenser", label: "Condenser" },
    { value: "heat_pump", label: "Heat pump" },
  ],
  indoor: [
    { value: "ahu", label: "Air handler" },
    { value: "furnace", label: "Furnace" },
  ],
}

function sideOf(kind: VisitEquipment["kind"]): Side | null {
  if (kind === "condenser" || kind === "heat_pump") return "outdoor"
  if (kind === "ahu" || kind === "furnace") return "indoor"
  return null
}

function formFor(side: Side, existing: VisitEquipment | undefined): Form {
  return {
    id: existing?.id ?? null,
    kind: (existing?.kind as Form["kind"]) ?? KINDS[side][0]!.value,
    brand: existing?.brand ?? "",
    model: existing?.model ?? "",
    serial: existing?.serial ?? "",
    tons: existing?.tons ? String(existing.tons) : "",
    refrigerant: existing?.refrigerant ?? "",
  }
}

/** The unit's equipment: the permanent place for model and serial, kept across visits. */
export function UnitEquipment({
  unitId,
  equipment,
  onNameplatePhoto,
}: {
  unitId: string
  equipment: VisitEquipment[]
  onNameplatePhoto: (dataUrl: string) => void
}) {
  const find = (side: Side) => equipment.find((e) => sideOf(e.kind) === side)
  return (
    <section className="flex flex-col gap-3">
      <p className="text-[15px] text-muted-foreground">
        Saved to this unit, so it&apos;s here on every visit. Scan the nameplate or type it.
      </p>
      <EquipmentCard side="outdoor" unitId={unitId} existing={find("outdoor")} onPhoto={onNameplatePhoto} />
      <EquipmentCard side="indoor" unitId={unitId} existing={find("indoor")} onPhoto={onNameplatePhoto} />
    </section>
  )
}

function EquipmentCard({
  side,
  unitId,
  existing,
  onPhoto,
}: {
  side: Side
  unitId: string
  existing: VisitEquipment | undefined
  onPhoto: (dataUrl: string) => void
}) {
  const router = useRouter()
  const [saved, setSaved] = useState<Form>(() => formFor(side, existing))
  const [form, setForm] = useState<Form>(saved)
  const [notice, setNotice] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null)
  const [scanning, startScan] = useTransition()
  const [saving, startSave] = useTransition()
  const changed = JSON.stringify(form) !== JSON.stringify(saved)
  const id = (k: string) => `${side}-${k}`
  const set = (k: keyof Form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }))
    setNotice(null)
  }

  function scan(file: File) {
    startScan(async () => {
      setNotice(null)
      const dataUrl = await prepareForReading(file)
      if (!dataUrl) {
        setNotice({ tone: "error", text: "That photo didn't load. Try again." })
        return
      }
      onPhoto(dataUrl)
      const r = await readNameplate(dataUrl)
      if (!r.ok) {
        setNotice({ tone: "error", text: r.message })
        return
      }
      const v = r.value
      setForm((f) => ({
        ...f,
        brand: matchBrand(v.brand) ?? f.brand,
        model: v.model ?? f.model,
        serial: v.serial ?? f.serial,
        tons: v.tons ? String(v.tons) : f.tons,
        refrigerant: matchRefrigerant(v.refrigerant) ?? f.refrigerant,
      }))
      setNotice(
        v.confidence === "low"
          ? { tone: "warn", text: "Read it, but part was hard to see. Check every character against the plate, then Save." }
          : { tone: "ok", text: "Read from the plate. Check it, then Save." },
      )
    })
  }

  function save() {
    startSave(async () => {
      const r = await saveEquipment({ ...form, unitId })
      if (!r.ok) {
        setNotice({ tone: "error", text: r.message })
        return
      }
      const next = { ...form, id: r.value.id }
      setSaved(next)
      setForm(next)
      setNotice({ tone: "ok", text: "Saved to this unit." })
      router.refresh()
    })
  }

  const pick = "h-12 w-full rounded-xl border-2 border-ink/70 bg-card px-3 text-[17px] outline-none focus-visible:border-primary"
  const field = "h-12 w-full rounded-xl border-2 border-ink/70 bg-card px-3 text-[17px] uppercase tabular-nums outline-none focus-visible:border-primary"
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
          {side === "outdoor" ? "Outdoor unit" : "Indoor unit"}
        </p>
        <label className="sr-only" htmlFor={id("kind")}>
          Type
        </label>
        <select
          id={id("kind")}
          value={form.kind}
          onChange={(e) => set("kind", e.target.value)}
          className="h-10 rounded-lg border border-border bg-card px-2 text-base font-semibold"
        >
          {KINDS[side].map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </div>

      <label className="flex h-14 cursor-pointer items-center justify-center gap-2 rounded-xl bg-ink text-[17px] font-bold text-ink-foreground">
        {scanning ? "Reading the plate…" : "Scan nameplate"}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          disabled={scanning}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) scan(file)
            e.target.value = ""
          }}
        />
      </label>

      <div className="flex flex-col gap-1">
        <label htmlFor={id("model")} className="text-[15px] font-semibold">
          Model
        </label>
        <input id={id("model")} value={form.model} onChange={(e) => set("model", e.target.value)} className={field} autoCapitalize="characters" autoComplete="off" spellCheck={false} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={id("serial")} className="text-[15px] font-semibold">
          Serial
        </label>
        <input id={id("serial")} value={form.serial} onChange={(e) => set("serial", e.target.value)} className={field} autoCapitalize="characters" autoComplete="off" spellCheck={false} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={id("brand")} className="text-[15px] font-semibold">
          Brand
        </label>
        <select id={id("brand")} value={form.brand} onChange={(e) => set("brand", e.target.value)} className={pick}>
          <option value="">Pick a brand</option>
          {BRAND_GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.brands.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </optgroup>
          ))}
          <optgroup label="Other">
            <option value="ICP">ICP (other)</option>
            <option value="Other">Other</option>
            {form.brand && !brandListed(form.brand) ? <option value={form.brand}>{form.brand}</option> : null}
          </optgroup>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={id("tons")} className="text-[15px] font-semibold">
            Size
          </label>
          <select id={id("tons")} value={form.tons} onChange={(e) => set("tons", e.target.value)} className={pick}>
            <option value="">Tons</option>
            {TON_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t} ton
              </option>
            ))}
            {form.tons && !TON_OPTIONS.includes(form.tons) ? <option value={form.tons}>{form.tons} ton</option> : null}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={id("ref")} className="text-[15px] font-semibold">
            Refrigerant
          </label>
          <select id={id("ref")} value={form.refrigerant} onChange={(e) => set("refrigerant", e.target.value)} className={pick}>
            <option value="">Pick one</option>
            {REFRIGERANT_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
            {form.refrigerant && !REFRIGERANT_OPTIONS.includes(form.refrigerant) ? (
              <option value={form.refrigerant}>{form.refrigerant}</option>
            ) : null}
          </select>
        </div>
      </div>

      {notice ? (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={
            "rounded-lg px-3 py-2 text-[14px] leading-5 font-medium " +
            (notice.tone === "error"
              ? "bg-destructive/10 text-destructive"
              : notice.tone === "warn"
                ? "bg-free text-free-foreground"
                : "bg-busy text-busy-foreground")
          }
        >
          {notice.text}
        </p>
      ) : null}
      {changed ? (
        <button
          type="button"
          disabled={saving}
          onClick={save}
          className="h-12 rounded-xl bg-primary text-[17px] font-bold text-primary-foreground disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save to this unit"}
        </button>
      ) : null}
    </div>
  )
}

const LISTED = new Set(["ICP", "Other", ...BRAND_GROUPS.flatMap((g) => g.brands)])
function brandListed(brand: string): boolean {
  return LISTED.has(brand)
}
