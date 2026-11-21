import "server-only"

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib"

import { BRAND_TAN, LOGO_HEIGHT, LOGO_OFFSET, LOGO_PATHS, LOGO_WIDTH } from "@/lib/brand-logo"

import { longDate, moneyExact, ratePercent } from "@/lib/review"
import { createClient } from "@/lib/supabase/server"

type Supabase = Awaited<ReturnType<typeof createClient>>

export type InvoiceDocument = {
  number: string
  invoiceDate: string
  dueDate: string
  termsDays: number
  customerName: string
  contactName: string | null
  billEmail: string | null
  propertyName: string
  unitLabel: string
  address: string
  lines: { description: string; amountCents: number }[]
  subtotalCents: number
  taxRateBps: number
  taxCents: number
  totalCents: number
  /** An estimate prints the reason and the approve link instead of terms. */
  kind?: "invoice" | "estimate"
  narrative?: string | null
  equipmentSize?: string | null
  link?: string | null
  /** yyyy-mm-dd the work was done, and who did it. */
  serviceDate?: string | null
  techName?: string | null
  /** e.g. "R-410A · 10 lb" — printed as a record under the lines. */
  refrigerant?: string | null
}

export const COMPANY = {
  name: process.env.COMPANY_NAME?.trim() || "Legend Service Pros LLC",
  address: process.env.COMPANY_ADDRESS?.trim() || "Greensboro, NC",
  phone: process.env.COMPANY_PHONE?.trim() || "",
  email: process.env.COMPANY_EMAIL?.trim() || "",
}

/** An approved invoice, as the property sees it. Null until it has a number. */
export async function loadInvoiceDocument(supabase: Supabase, id: string): Promise<InvoiceDocument | null> {
  const { data } = await supabase
    .from("invoice_records")
    .select(
      "number, invoice_date, due_date, terms_days_snap, bill_to_customer_id, bill_to_contact_id, bill_to_email_snap, property_snap, unit_snap, subtotal_cents, tax_rate_bps_snap, tax_cents, total_cents, request_id, refrigerant_type, refrigerant_lbs",
    )
    .eq("id", id)
    .maybeSingle()
  const inv = data as {
    number: string | null
    invoice_date: string | null
    due_date: string | null
    terms_days_snap: number
    bill_to_customer_id: string
    bill_to_contact_id: string
    bill_to_email_snap: string
    property_snap: string
    unit_snap: string
    subtotal_cents: number
    tax_rate_bps_snap: number
    tax_cents: number
    total_cents: number
    request_id: string
    refrigerant_type: string | null
    refrigerant_lbs: number | string | null
  } | null
  if (!inv || !inv.number || !inv.invoice_date || !inv.due_date) return null

  const [lines, customer, contact, request] = await Promise.all([
    supabase.from("invoice_lines").select("description_customer, amount_cents").eq("invoice_id", id).order("sort"),
    supabase.from("customers").select("name").eq("id", inv.bill_to_customer_id).maybeSingle(),
    supabase.from("customer_contacts").select("name").eq("id", inv.bill_to_contact_id).maybeSingle(),
    supabase
      .from("service_requests")
      .select("assigned_user_id, properties ( address_line1, city, state, zip )")
      .eq("id", inv.request_id)
      .maybeSingle(),
  ])
  type Prop = { address_line1: string; city: string; state: string; zip: string }
  const req = request.data as { assigned_user_id: string | null; properties: Prop | Prop[] | null } | null
  const propRaw = req?.properties
  const prop = Array.isArray(propRaw) ? propRaw[0] : propRaw
  const [visit, tech] = await Promise.all([
    supabase
      .from("service_visits")
      .select("closed_at")
      .eq("request_id", inv.request_id)
      .eq("status", "closed")
      .order("visit_seq", { ascending: false })
      .limit(1),
    req?.assigned_user_id
      ? supabase.from("profiles").select("full_name").eq("id", req.assigned_user_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const closedAt = ((visit.data ?? []) as { closed_at: string | null }[])[0]?.closed_at ?? null
  const techName = (tech.data as { full_name: string } | null)?.full_name ?? null
  const lbs = inv.refrigerant_lbs === null ? null : Number(inv.refrigerant_lbs)
  return {
    serviceDate: closedAt ? nyDate(closedAt) : null,
    techName: techName ? techName.replace(/\b\w/g, (c) => c.toUpperCase()) : null,
    refrigerant:
      lbs !== null && lbs > 0
        ? `${inv.refrigerant_type ?? "Refrigerant"} · ${Number.isInteger(lbs) ? lbs : lbs.toFixed(2).replace(/0$/, "")} lb`
        : null,
    number: inv.number,
    invoiceDate: inv.invoice_date,
    dueDate: inv.due_date,
    termsDays: inv.terms_days_snap,
    customerName: (customer.data as { name: string } | null)?.name ?? "",
    contactName: (contact.data as { name: string } | null)?.name ?? null,
    billEmail: inv.bill_to_email_snap === "unset" ? null : inv.bill_to_email_snap,
    propertyName: inv.property_snap,
    unitLabel: inv.unit_snap,
    address: prop ? `${prop.address_line1}, ${prop.city}, ${prop.state} ${prop.zip}` : "",
    lines: ((lines.data ?? []) as { description_customer: string; amount_cents: number }[]).map((l) => ({
      description: l.description_customer,
      amountCents: l.amount_cents,
    })),
    subtotalCents: inv.subtotal_cents,
    taxRateBps: inv.tax_rate_bps_snap,
    taxCents: inv.tax_cents,
    totalCents: inv.total_cents,
  }
}

function nyDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso))
}

/** A sent estimate, as the property sees it. Null until it has a number. */
export async function loadEstimateDocument(
  supabase: Supabase,
  id: string,
  link: string | null,
): Promise<InvoiceDocument | null> {
  const { data } = await supabase
    .from("estimates")
    .select(
      "number, sent_at, narrative, equipment_size_text, bill_to_contact_id, bill_to_email_snap, property_snap, unit_snap, subtotal_cents, tax_rate_bps_snap, tax_cents, total_cents, request_id",
    )
    .eq("id", id)
    .maybeSingle()
  const est = data as {
    number: string | null
    sent_at: string | null
    narrative: string
    equipment_size_text: string | null
    bill_to_contact_id: string | null
    bill_to_email_snap: string | null
    property_snap: string | null
    unit_snap: string | null
    subtotal_cents: number
    tax_rate_bps_snap: number
    tax_cents: number
    total_cents: number
    request_id: string
  } | null
  if (!est || !est.number || !est.sent_at) return null

  const [lines, request] = await Promise.all([
    supabase.from("estimate_lines").select("description_customer, amount_cents").eq("estimate_id", id).order("sort"),
    supabase
      .from("service_requests")
      .select("contact_id, customers ( name ), properties ( address_line1, city, state, zip )")
      .eq("id", est.request_id)
      .maybeSingle(),
  ])
  type Prop = { address_line1: string; city: string; state: string; zip: string }
  type Req = { contact_id: string; customers: { name: string } | { name: string }[] | null; properties: Prop | Prop[] | null }
  const req = request.data as Req | null
  const prop = Array.isArray(req?.properties) ? req?.properties[0] : req?.properties
  const cust = Array.isArray(req?.customers) ? req?.customers[0] : req?.customers
  const contactId = est.bill_to_contact_id ?? req?.contact_id ?? null
  const { data: contact } = contactId
    ? await supabase.from("customer_contacts").select("name").eq("id", contactId).maybeSingle()
    : { data: null }
  const day = nyDate(est.sent_at)
  return {
    kind: "estimate",
    number: est.number,
    invoiceDate: day,
    dueDate: day,
    termsDays: 0,
    customerName: cust?.name ?? "",
    contactName: (contact as { name: string } | null)?.name ?? null,
    billEmail: est.bill_to_email_snap && est.bill_to_email_snap !== "unset" ? est.bill_to_email_snap : null,
    propertyName: est.property_snap ?? "",
    unitLabel: est.unit_snap ?? "",
    address: prop ? `${prop.address_line1}, ${prop.city}, ${prop.state} ${prop.zip}` : "",
    lines: ((lines.data ?? []) as { description_customer: string; amount_cents: number }[]).map((l) => ({
      description: l.description_customer,
      amountCents: l.amount_cents,
    })),
    subtotalCents: est.subtotal_cents,
    taxRateBps: est.tax_rate_bps_snap,
    taxCents: est.tax_cents,
    totalCents: est.total_cents,
    narrative: est.narrative,
    equipmentSize: est.equipment_size_text,
    link,
  }
}

/** The standard PDF fonts only carry Western characters. */
function plain(text: string): string {
  return text
    .replace(/−/g, "-")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "")
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = []
  for (const para of plain(text).split(/\n+/)) {
    let line = ""
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(next, size) <= width || !line) {
        line = next
      } else {
        out.push(line)
        line = word
      }
    }
    if (line) out.push(line)
  }
  return out.length ? out : [""]
}

const hex = (h: string) =>
  rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255)

/** The LSP logo with its top-left corner at (x, top), `width` points wide. */
function drawLogo(page: PDFPage, x: number, top: number, width: number) {
  const s = width / LOGO_WIDTH
  for (const p of LOGO_PATHS) {
    page.drawSvgPath(p.d, {
      x: x + LOGO_OFFSET.x * s,
      y: top - LOGO_OFFSET.y * s,
      scale: s,
      color: hex(p.fill),
      ...(p.stroke ? { borderColor: hex(p.stroke), borderWidth: p.strokeWidth } : {}),
    })
  }
  return (LOGO_HEIGHT * width) / LOGO_WIDTH
}

export async function renderInvoicePdf(doc: InvoiceDocument): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const estimate = doc.kind === "estimate"
  const title = estimate ? "Estimate" : "Invoice"
  pdf.setTitle(`${title} ${doc.number}`)
  pdf.setAuthor(COMPANY.name)
  pdf.setCreator(COMPANY.name)
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const ink = rgb(0.067, 0.082, 0.094)
  const grey = rgb(0.36, 0.39, 0.43)
  const rule = rgb(0.85, 0.85, 0.83)
  const tan = hex(BRAND_TAN)
  const tanLight = rgb(0.985, 0.965, 0.925)

  const W = 612
  const H = 792
  const M = 48
  const pages: PDFPage[] = []
  let page: PDFPage = pdf.addPage([W, H])
  pages.push(page)
  let y = H - M

  const text = (s: string, x: number, yy: number, size = 10, font = regular, color = ink) =>
    page.drawText(plain(s), { x, y: yy, size, font, color })
  const right = (s: string, xr: number, yy: number, size = 10, font = regular, color = ink) =>
    text(s, xr - font.widthOfTextAtSize(plain(s), size), yy, size, font, color)
  const label = (s: string, x: number, yy: number) => text(s.toUpperCase(), x, yy, 7.5, bold, grey)

  // ---- Header: logo and company on the left, the document on the right.
  const logoH = drawLogo(page, M, y, 168)
  const companyLines = [COMPANY.name, COMPANY.address, [COMPANY.phone, COMPANY.email].filter(Boolean).join("  ·  ")]
    .filter(Boolean)
  companyLines.forEach((l, i) => text(l, M, y - logoH - 16 - i * 12, i === 0 ? 9.5 : 9, i === 0 ? bold : regular, i === 0 ? ink : grey))

  right(title.toUpperCase(), W - M, y - 22, 26, bold)
  right(`No. ${doc.number}`, W - M, y - 40, 11, bold, grey)
  const meta: [string, string][] = estimate
    ? ([
        ["Date", longDate(doc.invoiceDate)],
        doc.equipmentSize ? ["Equipment", doc.equipmentSize] : null,
        doc.techName ? ["Prepared by", doc.techName] : null,
      ].filter(Boolean) as [string, string][])
    : ([
        ["Invoice date", longDate(doc.invoiceDate)],
        ["Due", longDate(doc.dueDate)],
        ["Terms", doc.termsDays === 0 ? "Due on receipt" : `Net ${doc.termsDays}`],
        doc.serviceDate ? ["Service date", longDate(doc.serviceDate)] : null,
        doc.techName ? ["Technician", doc.techName] : null,
      ].filter(Boolean) as [string, string][])
  meta.forEach(([k, v], i) => {
    right(v, W - M, y - 60 - i * 13, 9.5, bold)
    right(k, W - M - 118, y - 60 - i * 13, 9.5, regular, grey)
  })
  const headerBottom = Math.min(y - logoH - 16 - companyLines.length * 12, y - 60 - meta.length * 13) - 8
  y = headerBottom
  page.drawRectangle({ x: M, y: y - 3, width: W - M * 2, height: 3, color: tan })
  page.drawLine({ start: { x: M, y: y - 3 }, end: { x: W - M, y: y - 3 }, thickness: 0.75, color: ink })
  y -= 26

  // ---- Who and where.
  const col2 = M + (W - M * 2) / 2 + 8
  label(estimate ? "Prepared for" : "Bill to", M, y)
  label("Service location", col2, y)
  y -= 14
  const billLines = [doc.customerName, doc.contactName, doc.billEmail].filter((l): l is string => Boolean(l))
  const siteLines = [doc.propertyName, `Unit ${doc.unitLabel}`, doc.address].filter(Boolean)
  const rows = Math.max(billLines.length, siteLines.length)
  for (let i = 0; i < rows; i += 1) {
    if (billLines[i]) text(billLines[i], M, y - i * 13, 10, i === 0 ? bold : regular)
    if (siteLines[i]) text(siteLines[i], col2, y - i * 13, 10, i === 0 ? bold : regular)
  }
  y -= rows * 13 + 18

  // ---- An estimate says what we found first.
  if (estimate && doc.narrative) {
    const reason = wrap(doc.narrative, regular, 10, W - M * 2 - 24)
    const boxH = reason.length * 13 + 30
    page.drawRectangle({ x: M, y: y - boxH + 12, width: W - M * 2, height: boxH, color: tanLight, borderColor: tan, borderWidth: 1 })
    label("What we found", M + 12, y - 2)
    reason.forEach((w, i) => text(w, M + 12, y - 18 - i * 13, 10))
    y -= boxH + 10
  }

  // ---- Lines.
  const amountX = W - M - 10
  const descWidth = W - M * 2 - 130
  const tableHeader = () => {
    page.drawRectangle({ x: M, y: y - 7, width: W - M * 2, height: 22, color: tan })
    text(estimate ? "PROPOSED WORK" : "WORK PERFORMED", M + 10, y, 8, bold)
    right("AMOUNT", amountX, y, 8, bold)
    y -= 26
  }
  const newPage = () => {
    page = pdf.addPage([W, H])
    pages.push(page)
    y = H - M
    drawLogo(page, M, y, 84)
    right(`${title} ${doc.number} (continued)`, W - M, y - 14, 9.5, bold, grey)
    y -= 44
  }
  tableHeader()
  for (const line of doc.lines) {
    const wrapped = wrap(line.description, regular, 10, descWidth)
    const need = wrapped.length * 13 + 12
    if (y - need < M + 110) {
      newPage()
      tableHeader()
    }
    wrapped.forEach((w, i) => text(w, M + 10, y - i * 13, 10))
    right(moneyExact(line.amountCents), amountX, y, 10, line.amountCents < 0 ? regular : bold)
    y -= wrapped.length * 13 + 5
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: rule })
    y -= 14
  }

  if (doc.refrigerant) {
    text(`Refrigerant added: ${doc.refrigerant}`, M + 10, y, 9, regular, grey)
    y -= 16
  }

  // ---- Totals, the last one highlighted.
  if (y < M + 120) newPage()
  const boxX = W - M - 230
  y -= 2
  text("Subtotal", boxX + 10, y, 10, regular, grey)
  right(moneyExact(doc.subtotalCents), amountX, y, 10)
  y -= 15
  text(`Sales tax (${ratePercent(doc.taxRateBps)})`, boxX + 10, y, 10, regular, grey)
  right(moneyExact(doc.taxCents), amountX, y, 10)
  y -= 12
  page.drawRectangle({ x: boxX, y: y - 22, width: W - M - boxX, height: 28, color: ink })
  text(estimate ? "Estimate total" : "Total due", boxX + 10, y - 13, 12, bold, rgb(1, 1, 1))
  right(moneyExact(doc.totalCents), amountX, y - 13, 13, bold, tan)
  y -= 44

  // ---- What happens next.
  if (estimate) {
    if (doc.link) {
      text("To approve or decline this estimate, open:", M, y, 10, bold)
      text(doc.link, M, y - 14, 9, regular, grey)
      y -= 32
    }
  } else {
    text(
      doc.termsDays === 0 ? "Payment is due on receipt." : `Payment is due by ${longDate(doc.dueDate)} (net ${doc.termsDays}).`,
      M,
      y,
      10,
      bold,
    )
    text(`Please reference invoice ${doc.number} with your payment. Thank you for your business.`, M, y - 14, 9, regular, grey)
  }

  // ---- Footer on every page.
  const contact = [COMPANY.name, COMPANY.phone, COMPANY.email].filter(Boolean).join("  ·  ")
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: M - 4 }, end: { x: W - M, y: M - 4 }, thickness: 0.5, color: rule })
    p.drawText(plain(contact), { x: M, y: M - 18, size: 8, font: regular, color: grey })
    const n = `Page ${i + 1} of ${pages.length}`
    p.drawText(n, { x: W - M - regular.widthOfTextAtSize(n, 8), y: M - 18, size: 8, font: regular, color: grey })
  })
  return pdf.save()
}
