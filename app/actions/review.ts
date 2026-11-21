"use server"

import { revalidatePath } from "next/cache"

import { isSupabaseConfigured } from "@/lib/env"
import { emailPdf } from "@/lib/invoice-mail"
import { COMPANY, loadInvoiceDocument, renderInvoicePdf } from "@/lib/invoice-pdf"
import { invoiceEmail, longDate } from "@/lib/review"
import { isUuid } from "@/lib/setup"
import { createClient } from "@/lib/supabase/server"

export type ReviewResult = { ok: true; message: string | null } | { ok: false; message: string }

/** Every review action re-checks the owner role. The database checks it again. */
async function ownerClient() {
  if (!isSupabaseConfigured()) return { ok: false as const, message: "The database is not connected." }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, message: "Sign in again." }
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, active")
    .eq("auth_user_id", user.id)
    .maybeSingle()
  const p = profile as { role: string; active: boolean } | null
  if (!p?.active || p.role !== "owner") return { ok: false as const, message: "Only owners can review invoices." }
  return { ok: true as const, supabase }
}

function friendly(message: string | undefined): string {
  if (!message) return "That didn't save. Try again."
  if (/fetch failed|network/i.test(message)) return "No connection. Try again when you have signal."
  return message
}

function done(invoiceId: string, message: string | null = null): ReviewResult {
  revalidatePath("/review", "layout")
  revalidatePath(`/review/invoice/${invoiceId}`)
  return { ok: true, message }
}

export async function setCostLine(
  invoiceId: string,
  costLineId: string,
  change: { removed?: boolean; amountCents?: number },
): Promise<ReviewResult> {
  const ready = await ownerClient()
  if (!ready.ok) return ready
  if (!isUuid(costLineId) || !isUuid(invoiceId)) return { ok: false, message: "Reload the invoice." }
  const { error } = await ready.supabase.rpc("set_invoice_cost_line", {
    cost_line_id: costLineId,
    removed: change.removed ?? null,
    amount_cents: change.amountCents ?? null,
  })
  if (error) return { ok: false, message: friendly(error.message) }
  return done(invoiceId)
}

export async function updateLine(
  invoiceId: string,
  lineId: string,
  description: string,
  amountCents: number | null,
): Promise<ReviewResult> {
  const ready = await ownerClient()
  if (!ready.ok) return ready
  if (!isUuid(lineId) || !isUuid(invoiceId)) return { ok: false, message: "Reload the invoice." }
  const { error } = await ready.supabase.rpc("update_invoice_line", {
    line_id: lineId,
    description,
    amount_cents: amountCents,
  })
  if (error) return { ok: false, message: friendly(error.message) }
  return done(invoiceId)
}

export async function addLine(invoiceId: string, description: string, amountCents: number): Promise<ReviewResult> {
  const ready = await ownerClient()
  if (!ready.ok) return ready
  if (!isUuid(invoiceId)) return { ok: false, message: "Reload the invoice." }
  const { error } = await ready.supabase.rpc("add_invoice_line", {
    invoice_id: invoiceId,
    description,
    amount_cents: amountCents,
  })
  if (error) return { ok: false, message: friendly(error.message) }
  return done(invoiceId)
}

export async function removeLine(invoiceId: string, lineId: string): Promise<ReviewResult> {
  const ready = await ownerClient()
  if (!ready.ok) return ready
  if (!isUuid(lineId) || !isUuid(invoiceId)) return { ok: false, message: "Reload the invoice." }
  const { error } = await ready.supabase.rpc("remove_invoice_line", { line_id: lineId })
  if (error) return { ok: false, message: friendly(error.message) }
  return done(invoiceId)
}

export async function askTech(invoiceId: string, question: string): Promise<ReviewResult> {
  const ready = await ownerClient()
  if (!ready.ok) return ready
  if (!isUuid(invoiceId)) return { ok: false, message: "Reload the invoice." }
  const { data, error } = await ready.supabase.rpc("ask_about_invoice", { invoice_id: invoiceId, question })
  if (error) return { ok: false, message: friendly(error.message) }
  const result = data as { tech: string; sms: string } | null
  const first = result?.tech?.split(" ")[0] ?? "The tech"
  return done(
    invoiceId,
    result?.sms === "queued"
      ? `Question saved. ${first} sees it on My jobs; the text goes out once texting is set up.`
      : `Question saved. ${first} sees it on My jobs (no phone on file for a text).`,
  )
}

async function sendInvoiceEmail(
  supabase: Awaited<ReturnType<typeof createClient>>,
  invoiceId: string,
): Promise<string> {
  const doc = await loadInvoiceDocument(supabase, invoiceId)
  if (!doc) return "The invoice was approved, but its PDF could not be built. Open it again."
  const pdf = await renderInvoicePdf(doc)
  const mail = invoiceEmail({
    number: doc.number,
    propertyName: doc.propertyName,
    unitLabel: doc.unitLabel,
    totalCents: doc.totalCents,
    dueLabel: longDate(doc.dueDate),
    companyName: COMPANY.name,
  })
  const outcome = await emailPdf({
    to: doc.billEmail,
    subject: mail.subject,
    text: mail.text,
    filename: `LSP invoice ${doc.number}.pdf`,
    pdf,
  })

  const status = outcome.status === "sent" ? "sent" : outcome.status === "failed" ? "failed" : "queued"
  await supabase.rpc("record_invoice_email", {
    invoice_id: invoiceId,
    to_address: doc.billEmail ?? "unset",
    status,
    provider_id: outcome.status === "sent" ? outcome.providerId : null,
    body: mail.subject,
  })

  if (outcome.status === "sent") return `Invoice ${doc.number} emailed to ${doc.billEmail}.`
  if (outcome.status === "failed") {
    return `Invoice ${doc.number} is approved, but the email failed (${outcome.reason}). Try Send again, or download the PDF.`
  }
  if (outcome.reason === "test_mode") {
    return `Invoice ${doc.number} approved. Test copy: no email went out. Download the PDF to check it.`
  }
  if (outcome.reason === "no_address") {
    return `Invoice ${doc.number} approved. No billing email on file, so download the PDF and send it yourself.`
  }
  return `Invoice ${doc.number} approved. Email isn't set up yet, so download the PDF and send it.`
}

export async function approveAndSend(invoiceId: string, seenAt: string): Promise<ReviewResult> {
  const ready = await ownerClient()
  if (!ready.ok) return ready
  if (!isUuid(invoiceId)) return { ok: false, message: "Reload the invoice." }
  const { error } = await ready.supabase.rpc("approve_invoice", { invoice_id: invoiceId, seen_at: seenAt })
  if (error) return { ok: false, message: friendly(error.message) }
  const message = await sendInvoiceEmail(ready.supabase, invoiceId)
  revalidatePath("/board")
  return done(invoiceId, message)
}

export async function sendAgain(invoiceId: string): Promise<ReviewResult> {
  const ready = await ownerClient()
  if (!ready.ok) return ready
  if (!isUuid(invoiceId)) return { ok: false, message: "Reload the invoice." }
  const message = await sendInvoiceEmail(ready.supabase, invoiceId)
  return done(invoiceId, message)
}

/** The owner corrects the refrigerant type and pounds; the price follows. */
export async function setInvoiceRefrigerant(
  invoiceId: string,
  refrigerantType: string,
  lbs: number,
): Promise<ReviewResult> {
  const ready = await ownerClient()
  if (!ready.ok) return ready
  if (!isUuid(invoiceId)) return { ok: false, message: "Reload the invoice." }
  if (!Number.isFinite(lbs) || lbs < 0 || lbs > 200) return { ok: false, message: "Enter the pounds added (0 to 200)." }
  const { error } = await ready.supabase.rpc("set_invoice_refrigerant", {
    invoice_id: invoiceId,
    refrigerant_type: refrigerantType.trim() || null,
    lbs: Math.round(lbs * 100) / 100,
  })
  if (error) return { ok: false, message: friendly(error.message) }
  revalidatePath("/review", "layout")
  revalidatePath(`/review/invoice/${invoiceId}`)
  return { ok: true, message: null }
}

