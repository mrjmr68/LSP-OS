"use server"

import { revalidatePath } from "next/cache"
import { headers } from "next/headers"

import { isSupabaseConfigured } from "@/lib/env"
import { emailPdf } from "@/lib/invoice-mail"
import { COMPANY, loadEstimateDocument, renderInvoicePdf } from "@/lib/invoice-pdf"
import { estimateEmail } from "@/lib/review"
import { isUuid } from "@/lib/setup"
import { createClient } from "@/lib/supabase/server"

import type { ReviewResult } from "./review"

type Supabase = Awaited<ReturnType<typeof createClient>>

/** Every estimate action re-checks the owner role. The database checks it again. */
async function ownerClient() {
  if (!isSupabaseConfigured())
    return { ok: false as const, message: "The database is not connected." }
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
  if (!p?.active || p.role !== "owner")
    return { ok: false as const, message: "Only owners can send estimates." }
  return { ok: true as const, supabase }
}

function friendly(message: string | undefined): string {
  if (!message) return "That didn't save. Try again."
  if (/fetch failed|network/i.test(message)) return "No connection. Try again when you have signal."
  return message
}

function done(estimateId: string, message: string | null = null): ReviewResult {
  revalidatePath("/review", "layout")
  revalidatePath(`/review/estimate/${estimateId}`)
  revalidatePath("/board")
  return { ok: true, message }
}

/** The property's approve link on whichever copy of the app this is. */
async function estimateLink(token: string): Promise<string> {
  const h = await headers()
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "lsp-os-matt-6243s-projects.vercel.app"
  const proto = h.get("x-forwarded-proto") ?? "https"
  return `${proto}://${host}/e/${token}`
}

export async function setEstimateCostLine(
  estimateId: string,
  costLineId: string,
  change: { removed?: boolean; amountCents?: number },
): Promise<ReviewResult> {
  const ready = await ownerClient()
  if (!ready.ok) return ready
  if (!isUuid(costLineId) || !isUuid(estimateId))
    return { ok: false, message: "Reload the estimate." }
  const { error } = await ready.supabase.rpc("set_estimate_cost_line", {
    cost_line_id: costLineId,
    removed: change.removed ?? null,
    amount_cents: change.amountCents ?? null,
  })
  if (error) return { ok: false, message: friendly(error.message) }
  return done(estimateId)
}

export async function updateEstimateLine(
  estimateId: string,
  lineId: string,
  description: string,
  amountCents: number | null,
): Promise<ReviewResult> {
  const ready = await ownerClient()
  if (!ready.ok) return ready
  if (!isUuid(lineId) || !isUuid(estimateId)) return { ok: false, message: "Reload the estimate." }
  const { error } = await ready.supabase.rpc("update_estimate_line", {
    line_id: lineId,
    description,
    amount_cents: amountCents,
  })
  if (error) return { ok: false, message: friendly(error.message) }
  return done(estimateId)
}

export async function addEstimateLine(
  estimateId: string,
  description: string,
  amountCents: number,
): Promise<ReviewResult> {
  const ready = await ownerClient()
  if (!ready.ok) return ready
  if (!isUuid(estimateId)) return { ok: false, message: "Reload the estimate." }
  const { error } = await ready.supabase.rpc("add_estimate_line", {
    estimate_id: estimateId,
    description,
    amount_cents: amountCents,
  })
  if (error) return { ok: false, message: friendly(error.message) }
  return done(estimateId)
}

export async function removeEstimateLine(
  estimateId: string,
  lineId: string,
): Promise<ReviewResult> {
  const ready = await ownerClient()
  if (!ready.ok) return ready
  if (!isUuid(lineId) || !isUuid(estimateId)) return { ok: false, message: "Reload the estimate." }
  const { error } = await ready.supabase.rpc("remove_estimate_line", { line_id: lineId })
  if (error) return { ok: false, message: friendly(error.message) }
  return done(estimateId)
}

export async function updateEstimateDetails(
  estimateId: string,
  narrative: string,
  equipmentSize: string,
): Promise<ReviewResult> {
  const ready = await ownerClient()
  if (!ready.ok) return ready
  if (!isUuid(estimateId)) return { ok: false, message: "Reload the estimate." }
  const { error } = await ready.supabase.rpc("update_estimate_details", {
    estimate_id: estimateId,
    narrative,
    equipment_size: equipmentSize.trim() || null,
  })
  if (error) return { ok: false, message: friendly(error.message) }
  return done(estimateId)
}

async function sendEstimateEmail(
  supabase: Supabase,
  estimateId: string,
  token: string,
): Promise<string> {
  const link = await estimateLink(token)
  const doc = await loadEstimateDocument(supabase, estimateId, link)
  if (!doc) return "The estimate was sent, but its PDF could not be built. Open it again."
  const pdf = await renderInvoicePdf(doc)
  const mail = estimateEmail({
    number: doc.number,
    propertyName: doc.propertyName,
    unitLabel: doc.unitLabel,
    totalCents: doc.totalCents,
    link,
    companyName: COMPANY.name,
  })
  const outcome = await emailPdf({
    to: doc.billEmail,
    subject: mail.subject,
    text: mail.text,
    filename: `LSP estimate ${doc.number}.pdf`,
    pdf,
  })
  const status =
    outcome.status === "sent" ? "sent" : outcome.status === "failed" ? "failed" : "queued"
  await supabase.rpc("record_estimate_email", {
    estimate_id: estimateId,
    to_address: doc.billEmail ?? "unset",
    status,
    provider_id: outcome.status === "sent" ? outcome.providerId : null,
    body: mail.subject,
  })

  if (outcome.status === "sent")
    return `Estimate ${doc.number} emailed to ${doc.billEmail} with the approve link.`
  if (outcome.status === "failed") {
    return `Estimate ${doc.number} is out, but the email failed (${outcome.reason}). Try Send again, or copy the link.`
  }
  if (outcome.reason === "test_mode") {
    return `Estimate ${doc.number} marked sent. Test copy: no email went out. Open the property's link to try it.`
  }
  if (outcome.reason === "no_address") {
    return `Estimate ${doc.number} marked sent. No email on file, so copy the link or download the PDF and send it.`
  }
  return `Estimate ${doc.number} marked sent. Email isn't set up yet, so copy the link or download the PDF and send it.`
}

export async function sendEstimate(estimateId: string, seenAt: string): Promise<ReviewResult> {
  const ready = await ownerClient()
  if (!ready.ok) return ready
  if (!isUuid(estimateId)) return { ok: false, message: "Reload the estimate." }
  const { data, error } = await ready.supabase.rpc("send_estimate", {
    estimate_id: estimateId,
    seen_at: seenAt,
  })
  if (error) return { ok: false, message: friendly(error.message) }
  const token = (data as { token: string } | null)?.token
  const message = token
    ? await sendEstimateEmail(ready.supabase, estimateId, token)
    : "Estimate sent."
  return done(estimateId, message)
}

export async function sendEstimateAgain(estimateId: string): Promise<ReviewResult> {
  const ready = await ownerClient()
  if (!ready.ok) return ready
  if (!isUuid(estimateId)) return { ok: false, message: "Reload the estimate." }
  const { data } = await ready.supabase
    .from("estimates")
    .select("public_token, status")
    .eq("id", estimateId)
    .maybeSingle()
  const row = data as { public_token: string | null; status: string } | null
  if (!row?.public_token || !["sent", "viewed"].includes(row.status)) {
    return { ok: false, message: "That estimate isn't waiting on the property." }
  }
  const message = await sendEstimateEmail(ready.supabase, estimateId, row.public_token)
  return done(estimateId, message)
}

/** The property said yes or no by phone, text or email. */
export async function recordEstimateAnswer(
  estimateId: string,
  approve: boolean,
  note: string,
): Promise<ReviewResult> {
  const ready = await ownerClient()
  if (!ready.ok) return ready
  if (!isUuid(estimateId)) return { ok: false, message: "Reload the estimate." }
  const { data, error } = await ready.supabase.rpc("record_estimate_response", {
    estimate_id: estimateId,
    approve,
    note: note.trim() || null,
  })
  if (error) return { ok: false, message: friendly(error.message) }
  const board = (data as { board?: string } | null)?.board
  return done(
    estimateId,
    !approve
      ? "Marked declined. Bill the diagnostic or close it with no charge."
      : board === "parts"
        ? "Approved. The job is in Parts with a part order to place."
        : "Approved. The job is in Ready for a tech.",
  )
}

/** After a decline: bill the diagnostic (a draft invoice) or close with no charge. */
export async function settleDeclined(
  estimateId: string,
  bill: boolean,
): Promise<ReviewResult & { invoiceId?: string }> {
  const ready = await ownerClient()
  if (!ready.ok) return ready
  if (!isUuid(estimateId)) return { ok: false, message: "Reload the estimate." }
  const { data, error } = await ready.supabase.rpc("settle_declined_estimate", {
    estimate_id: estimateId,
    bill,
  })
  if (error) return { ok: false, message: friendly(error.message) }
  const invoiceId = (data as { invoice_id?: string } | null)?.invoice_id
  const result = done(
    estimateId,
    bill ? "Diagnostic drafted. It's in Needs you to approve and send." : "Closed with no charge.",
  )
  return invoiceId ? { ...result, invoiceId } : result
}
