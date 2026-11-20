"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { readNameplate, saveEquipment, type EquipmentInput } from "@/app/actions/nameplate"
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
        brand: v.brand ?? f.brand,
        model: v.model ?? f.model,
        serial: v.serial ?? f.serial,
        tons: v.tons ? String(v.tons) : f.tons,
        refrigerant: v.refrigerant ?? f.refrigerant,
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
          className="h-9 rounded-lg border border-border bg-card px-2 text-[14px] font-semibold"
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
      <div className="grid grid-cols-3 gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={id("brand")} className="text-[13px] font-semibold">
            Brand
          </label>
          <input id={id("brand")} value={form.brand} onChange={(e) => set("brand", e.target.value)} className="h-11 w-full rounded-lg border border-input bg-card px-2 text-[15px]" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={id("tons")} className="text-[13px] font-semibold">
            Tons
          </label>
          <input id={id("tons")} value={form.tons} onChange={(e) => set("tons", e.target.value)} inputMode="decimal" className="h-11 w-full rounded-lg border border-input bg-card px-2 text-[15px]" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={id("ref")} className="text-[13px] font-semibold">
            Refrigerant
          </label>
          <input id={id("ref")} value={form.refrigerant} onChange={(e) => set("refrigerant", e.target.value)} className="h-11 w-full rounded-lg border border-input bg-card px-2 text-[15px]" />
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

/** Big enough to read small print, small enough to send: 1600 px, JPEG. */
async function prepareForReading(file: File): Promise<string> {
  try {
    const bitmap = await createImageBitmap(file)
    for (const [edge, quality] of [
      [1600, 0.82],
      [1280, 0.75],
      [1024, 0.7],
    ] as const) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement("canvas")
      canvas.width = Math.round(bitmap.width * scale)
      canvas.height = Math.round(bitmap.height * scale)
      const ctx = canvas.getContext("2d")
      if (!ctx) return ""
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const url = canvas.toDataURL("image/jpeg", quality)
      if (url.length < 900_000) return url
    }
    return ""
  } catch {
    return ""
  }
}
