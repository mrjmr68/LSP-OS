// Reading an HVAC nameplate photo: the prompt, and turning the reply into fields.

export type NameplateFields = {
  side: "indoor" | "outdoor" | "unknown"
  brand: string | null
  model: string | null
  serial: string | null
  tons: number | null
  refrigerant: string | null
  /** Year the equipment was made, when the plate shows a manufacture date. */
  year: number | null
  /** "low" when the plate was hard to read; the tech should check the fields. */
  confidence: "high" | "low"
}

export const NAMEPLATE_PROMPT = `This is a photo of the nameplate (data plate) on a piece of residential HVAC equipment.
Read it and answer with ONLY one JSON object, no other text:
{"side":"indoor"|"outdoor"|"unknown","brand":string|null,"model":string|null,"serial":string|null,"tons":number|null,"refrigerant":string|null,"year":number|null,"confidence":"high"|"low"}
Rules:
- model is the value labeled MODEL, MODEL NO, M/N or MOD. serial is the value labeled SERIAL, SERIAL NO or S/N.
- Copy model and serial exactly as printed, character for character, without spaces you can't see. Never guess a character: if any part is unreadable, use null for that field and set confidence to "low".
- side: "outdoor" for a condenser or heat pump outdoor unit, "indoor" for an air handler, furnace or coil, else "unknown".
- tons only if a nominal capacity in tons is printed on the plate; otherwise null.
- refrigerant as printed (for example "R-410A", "R-454B", "R-22"), else null.
- year: the 4-digit year of manufacture only if a manufacture date (MFG DATE, DATE OF MFG, MFD) is printed; do not decode it from the serial. Else null.
- If this is not a nameplate, return all nulls with confidence "low".`

function cleanCode(value: unknown): string | null {
  if (typeof value !== "string") return null
  const v = value.trim().replace(/\s+/g, "").toUpperCase()
  return v.length >= 3 && v.length <= 40 ? v : null
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null
  const v = value.trim()
  return v ? v.slice(0, 60) : null
}

/** The model's reply → fields. Never throws; anything odd becomes null. */
export function parseNameplateReply(text: string): NameplateFields | null {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(match[0]) as Record<string, unknown>
  } catch {
    return null
  }
  const tons = typeof raw.tons === "number" && raw.tons > 0 && raw.tons <= 25 ? raw.tons : null
  const side = raw.side === "indoor" || raw.side === "outdoor" ? raw.side : "unknown"
  const thisYear = new Date().getFullYear()
  const year =
    typeof raw.year === "number" && Number.isInteger(raw.year) && raw.year >= 1970 && raw.year <= thisYear ? raw.year : null
  const fields: NameplateFields = {
    side,
    brand: cleanText(raw.brand),
    model: cleanCode(raw.model),
    serial: cleanCode(raw.serial),
    tons,
    refrigerant: cleanText(raw.refrigerant),
    year,
    confidence: raw.confidence === "high" ? "high" : "low",
  }
  if (!fields.model || !fields.serial) fields.confidence = "low"
  return fields
}

/** "GSX140361 · 1234567890" for a button that copies the unit's numbers into a form. */
export function equipmentLabel(e: { model: string | null; serial: string | null }): string {
  return [e.model, e.serial].filter(Boolean).join(" · ")
}

/** Brands we see in apartment work, grouped by maker. The phone shows a native picker. */
export const BRAND_GROUPS: { label: string; brands: string[] }[] = [
  { label: "Goodman family", brands: ["Goodman", "Amana", "Daikin"] },
  { label: "Rheem family", brands: ["Rheem", "Ruud", "WeatherKing"] },
  { label: "ICP", brands: ["Heil", "Tempstar", "Comfortmaker", "Arcoaire", "Day & Night", "KeepRite"] },
  { label: "Carrier family", brands: ["Carrier", "Bryant", "Payne"] },
  { label: "Trane family", brands: ["Trane", "American Standard"] },
  { label: "Lennox family", brands: ["Lennox", "Ducane"] },
  { label: "York family", brands: ["York", "Coleman", "Luxaire"] },
  { label: "Nortek", brands: ["Frigidaire", "Gibson", "Maytag", "Westinghouse", "Intertherm", "Miller"] },
]

export const TON_OPTIONS = ["1.5", "2", "2.5", "3", "3.5", "4", "5"]
export const REFRIGERANT_OPTIONS = ["R-410A", "R-454B", "R-32", "R-22", "R-407C"]

const ALL_BRANDS = BRAND_GROUPS.flatMap((g) => g.brands)

/** What the plate says → one of our brands ("GOODMAN MFG" → Goodman, "ICP" stays "ICP"). */
export function matchBrand(text: string | null): string | null {
  if (!text) return null
  const t = text.toLowerCase().replace(/[^a-z& ]/g, " ")
  const hit = ALL_BRANDS.find((b) => t.includes(b.toLowerCase()))
  if (hit) return hit
  if (/\bicp\b|international comfort/.test(t)) return "ICP"
  return text.trim().slice(0, 40)
}

/** "R410A", "r-410a", "HFC-410A" → "R-410A" when it's one we list. */
export function matchRefrigerant(text: string | null): string | null {
  if (!text) return null
  const digits = text.toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/^(R|HFC|HCFC)/, "")
  const hit = REFRIGERANT_OPTIONS.find((r) => r.replace("R-", "") === digits)
  return hit ?? text.trim().slice(0, 20)
}

/** Years for the "Year made" picker, newest first. */
export function yearOptions(now = new Date()): string[] {
  const out: string[] = []
  for (let y = now.getFullYear(); y >= 1985; y -= 1) out.push(String(y))
  return out
}

/**
 * The age check (Matt, Nov 19): a sealed-system part repair on equipment made
 * 10 or more years ago, or on R-22, should go out as an estimate (repair vs.
 * replace). Returns the reason to show, or null.
 */
export function ageCheck(
  equipment: { year: number | null; refrigerant: string | null }[],
  now = new Date(),
): string | null {
  if (equipment.some((e) => (e.refrigerant ?? "").replace(/[^0-9A-Z]/gi, "").toUpperCase() === "R22")) {
    return "This system runs on R-22."
  }
  const years = equipment.map((e) => e.year).filter((y): y is number => typeof y === "number")
  if (years.length === 0) return null
  const oldest = Math.min(...years)
  const age = now.getFullYear() - oldest
  return age >= 10 ? `This system is ${age} years old (made ${oldest}).` : null
}

/** Repairs on the sealed system that can trigger the age check. */
export function isSealedSystemRepair(title: string): boolean {
  return /coil|compressor|rev(ersing)?\s*valve|txv|leak|restriction|pres(sure)?\s*switch/i.test(title)
}
