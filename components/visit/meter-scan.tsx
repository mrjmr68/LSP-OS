"use client"

import { useState, useTransition } from "react"

import { readMeter } from "@/app/actions/nameplate"
import { prepareForReading } from "@/lib/photo-read"
import type { Readings } from "@/lib/visit"

/** Photo of the gauges or meter → fills the readings it can see. The tech checks them. */
export function MeterScan({ onValues }: { onValues: (values: Partial<Readings>) => void }) {
  const [reading, start] = useTransition()
  const [notice, setNotice] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null)
  return (
    <div className="flex flex-col gap-2">
      <label className="flex h-14 cursor-pointer items-center justify-center rounded-xl bg-ink text-[17px] font-bold text-ink-foreground">
        {reading ? "Reading the display…" : "Scan gauges or meter"}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          disabled={reading}
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ""
            if (!file) return
            start(async () => {
              setNotice(null)
              const url = await prepareForReading(file)
              if (!url) {
                setNotice({ tone: "error", text: "That photo didn't load. Try again." })
                return
              }
              const r = await readMeter(url)
              if (!r.ok) {
                setNotice({ tone: "error", text: r.message })
                return
              }
              onValues(r.value.values)
              const n = r.value.count
              setNotice(
                r.value.confidence === "low"
                  ? { tone: "warn", text: `Filled ${n} reading${n === 1 ? "" : "s"}, but the display was hard to read. Check them against the gauges.` }
                  : { tone: "ok", text: `Filled ${n} reading${n === 1 ? "" : "s"}. Check them against the gauges.` },
              )
            })
          }}
        />
      </label>
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
    </div>
  )
}
