import "server-only"

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib"

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
      "number, invoice_date, due_date, terms_days_snap, bill_to_customer_id, bill_to_contact_id, bill_to_email_snap, property_snap, unit_snap, subtotal_cents, tax_rate_bps_snap, tax_cents, total_cents, request_id",
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
  } | null
  if (!inv || !inv.number || !inv.invoice_date || !inv.due_date) return null

  const [lines, customer, contact, request] = await Promise.all([
    supabase.from("invoice_lines").select("description_customer, amount_cents").eq("invoice_id", id).order("sort"),
    supabase.from("customers").select("name").eq("id", inv.bill_to_customer_id).maybeSingle(),
    supabase.from("customer_contacts").select("name").eq("id", inv.bill_to_contact_id).maybeSingle(),
    supabase
      .from("service_requests")
      .select("properties ( address_line1, city, state, zip )")
      .eq("id", inv.request_id)
      .maybeSingle(),
  ])
  type Prop = { address_line1: string; city: string; state: string; zip: string }
  const propRaw = (request.data as { properties: Prop | Prop[] | null } | null)?.properties
  const prop = Array.isArray(propRaw) ? propRaw[0] : propRaw
  return {
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

export async function renderInvoicePdf(doc: InvoiceDocument): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`Invoice ${doc.number}`)
  pdf.setAuthor(COMPANY.name)
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const ink = rgb(0.067, 0.082, 0.094)
  const grey = rgb(0.29, 0.33, 0.38)
  const rule = rgb(0.84, 0.85, 0.83)

  const W = 612
  const H = 792
  const M = 54
  let page: PDFPage = pdf.addPage([W, H])
  let y = H - M

  const text = (s: string, x: number, yy: number, size = 10, font = regular, color = ink) =>
    page.drawText(plain(s), { x, y: yy, size, font, color })
  const right = (s: string, xr: number, yy: number, size = 10, font = regular, color = ink) =>
    text(s, xr - font.widthOfTextAtSize(plain(s), size), yy, size, font, color)

  // Header
  text(COMPANY.name, M, y - 4, 16, bold)
  const companyLines = [COMPANY.address, COMPANY.phone, COMPANY.email].filter(Boolean)
  companyLines.forEach((l, i) => text(l, M, y - 22 - i * 13, 10, regular, grey))
  right("INVOICE", W - M, y - 4, 20, bold)
  const meta: [string, string][] = [
    ["Invoice", doc.number],
    ["Date", longDate(doc.invoiceDate)],
    ["Due", longDate(doc.dueDate)],
    ["Terms", doc.termsDays === 0 ? "Due on receipt" : `Net ${doc.termsDays}`],
  ]
  meta.forEach(([k, v], i) => {
    right(v, W - M, y - 24 - i * 14, 10, bold)
    right(k, W - M - 130, y - 24 - i * 14, 10, regular, grey)
  })
  y -= 24 + meta.length * 14 + 24

  // Bill to / service location
  const col2 = M + 260
  text("BILL TO", M, y, 8, bold, grey)
  text("SERVICE LOCATION", col2, y, 8, bold, grey)
  y -= 14
  const billLines = [doc.customerName, doc.contactName, doc.billEmail].filter((l): l is string => Boolean(l))
  const siteLines = [`${doc.propertyName} · Unit ${doc.unitLabel}`, doc.address].filter(Boolean)
  const rows = Math.max(billLines.length, siteLines.length)
  for (let i = 0; i < rows; i += 1) {
    if (billLines[i]) text(billLines[i], M, y - i * 14, 10, i === 0 ? bold : regular)
    if (siteLines[i]) text(siteLines[i], col2, y - i * 14, 10, i === 0 ? bold : regular)
  }
  y -= rows * 14 + 22

  // Lines
  const amountX = W - M
  const descWidth = W - M * 2 - 110
  const header = () => {
    page.drawRectangle({ x: M, y: y - 6, width: W - M * 2, height: 20, color: rgb(0.953, 0.957, 0.945) })
    text("DESCRIPTION", M + 8, y, 8, bold, grey)
    right("AMOUNT", amountX - 8, y, 8, bold, grey)
    y -= 24
  }
  header()
  for (const line of doc.lines) {
    const wrapped = wrap(line.description, regular, 10, descWidth)
    const need = wrapped.length * 13 + 10
    if (y - need < M + 90) {
      page = pdf.addPage([W, H])
      y = H - M
      header()
    }
    wrapped.forEach((w, i) => text(w, M + 8, y - i * 13, 10))
    right(moneyExact(line.amountCents), amountX - 8, y, 10)
    y -= wrapped.length * 13 + 4
    page.drawLine({ start: { x: M, y: y }, end: { x: W - M, y: y }, thickness: 0.5, color: rule })
    y -= 14
  }

  // Totals
  const labelX = W - M - 200
  const totals: [string, string, boolean][] = [
    ["Subtotal", moneyExact(doc.subtotalCents), false],
    [`Sales tax (${ratePercent(doc.taxRateBps)})`, moneyExact(doc.taxCents), false],
    ["Total due", moneyExact(doc.totalCents), true],
  ]
  y -= 4
  for (const [label, value, strong] of totals) {
    text(label, labelX, y, strong ? 12 : 10, strong ? bold : regular, strong ? ink : grey)
    right(value, amountX - 8, y, strong ? 12 : 10, strong ? bold : regular)
    y -= strong ? 20 : 15
  }

  text("Thank you for your business.", M, M, 10, regular, grey)
  return pdf.save()
}
