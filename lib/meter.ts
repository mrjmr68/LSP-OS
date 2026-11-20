// Reading a gauge or meter photo into the six visit readings.

import type { Readings } from "@/lib/visit"

export const METER_PROMPT = `This photo shows HVAC service instruments: a digital or analog refrigerant manifold / gauge set, probe thermometers, or a meter display.
Read the values shown and answer with ONLY one JSON object, no other text:
{"suction":number|null,"liquid":number|null,"suctionLine":number|null,"liquidLine":number|null,"returnAir":number|null,"supplyAir":number|null,"confidence":"high"|"low"}
Meaning of each field:
- suction: low-side (suction/vapor, often blue) PRESSURE in psig.
- liquid: high-side (liquid/discharge, often red) PRESSURE in psig.
- suctionLine: suction/vapor LINE temperature in °F (a measured pipe temperature, not the saturation temperature).
- liquidLine: liquid LINE temperature in °F (measured, not saturation).
- returnAir / supplyAir: return and supply air temperatures in °F, only if labeled as such (e.g. "RA", "SA", "return", "supply", T1/T2 when clearly labeled).
Rules: only values you can actually read on the display; never compute or estimate a value; ignore superheat, subcool, saturation temps and target values. Convert nothing: if a pressure is not in psi or a temperature is not in °F, use null. If any value is uncertain, use null and set confidence to "low".`

const FIELDS = ["suction", "liquid", "suctionLine", "liquidLine", "returnAir", "supplyAir"] as const
type Key = (typeof FIELDS)[number]

const RANGES: Record<Key, [number, number]> = {
  suction: [0, 300],
  liquid: [0, 700],
  suctionLine: [-20, 150],
  liquidLine: [0, 200],
  returnAir: [30, 120],
  supplyAir: [20, 160],
}

/** The model's reply → the readings it found (strings, like the form) and how sure it was. */
export function parseMeterReply(text: string): { values: Partial<Readings>; confidence: "high" | "low"; count: number } | null {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(match[0]) as Record<string, unknown>
  } catch {
    return null
  }
  const values: Partial<Readings> = {}
  let count = 0
  for (const key of FIELDS) {
    const v = raw[key]
    if (typeof v !== "number" || !Number.isFinite(v)) continue
    const [lo, hi] = RANGES[key]
    if (v < lo || v > hi) continue
    values[key] = String(Math.round(v * 10) / 10)
    count += 1
  }
  return { values, confidence: raw.confidence === "high" ? "high" : "low", count }
}
