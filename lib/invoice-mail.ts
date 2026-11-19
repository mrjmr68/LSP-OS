import "server-only"

import { outboundAllowed } from "@/lib/app-mode"

export type MailOutcome =
  | { status: "sent"; providerId: string | null }
  | { status: "failed"; reason: string }
  | { status: "not_sent"; reason: "test_mode" | "not_configured" | "no_address" }

/** Emails a PDF through Resend. Never throws; the invoice is already approved. */
export async function emailPdf(input: {
  to: string | null
  subject: string
  text: string
  filename: string
  pdf: Uint8Array
}): Promise<MailOutcome> {
  if (!input.to) return { status: "not_sent", reason: "no_address" }
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? ""
  const from = (process.env.INVOICE_FROM_EMAIL ?? process.env.EMAIL_FROM)?.trim() ?? ""
  if (!outboundAllowed("email")) return { status: "not_sent", reason: "test_mode" }
  if (apiKey === "" || from === "") return { status: "not_sent", reason: "not_configured" }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [input.to],
        reply_to: process.env.COMPANY_EMAIL?.trim() || undefined,
        subject: input.subject,
        text: input.text,
        attachments: [{ filename: input.filename, content: Buffer.from(input.pdf).toString("base64") }],
      }),
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) {
      return { status: "failed", reason: `The mail service answered ${response.status}.` }
    }
    const body = (await response.json().catch(() => null)) as { id?: string } | null
    return { status: "sent", providerId: body?.id ?? null }
  } catch (error) {
    return { status: "failed", reason: error instanceof Error ? error.message : "The request failed." }
  }
}
