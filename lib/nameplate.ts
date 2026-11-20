// Reading an HVAC nameplate photo: the prompt, and turning the reply into fields.

export type NameplateFields = {
  side: "indoor" | "outdoor" | "unknown"
  brand: string | null
  model: string | null
  serial: string | null
  tons: number | null
  refrigerant: string | null
  /** "low" when the plate was hard to read; the tech should check the fields. */
  confidence: "high" | "low"
}

export const NAMEPLATE_PROMPT = `This is a photo of the nameplate (data plate) on a piece of residential HVAC equipment.
Read it and answer with ONLY one JSON object, no other text:
{"side":"indoor"|"outdoor"|"unknown","brand":string|null,"model":string|null,"serial":string|null,"tons":number|null,"refrigerant":string|null,"confidence":"high"|"low"}
Rules:
- model is the value labeled MODEL, MODEL NO, M/N or MOD. serial is the value labeled SERIAL, SERIAL NO or S/N.
- Copy model and serial exactly as printed, character for character, without spaces you can't see. Never guess a character: if any part is unreadable, use null for that field and set confidence to "low".
- side: "outdoor" for a condenser or heat pump outdoor unit, "indoor" for an air handler, furnace or coil, else "unknown".
- tons only if a nominal capacity in tons is printed on the plate; otherwise null.
- refrigerant as printed (for example "R-410A", "R-454B", "R-22"), else null.
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
  const fields: NameplateFields = {
    side,
    brand: cleanText(raw.brand),
    model: cleanCode(raw.model),
    serial: cleanCode(raw.serial),
    tons,
    refrigerant: cleanText(raw.refrigerant),
    confidence: raw.confidence === "high" ? "high" : "low",
  }
  if (!fields.model || !fields.serial) fields.confidence = "low"
  return fields
}

/** "GSX140361 · 1234567890" for a button that copies the unit's numbers into a form. */
export function equipmentLabel(e: { model: string | null; serial: string | null }): string {
  return [e.model, e.serial].filter(Boolean).join(" · ")
}
