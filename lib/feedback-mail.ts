import "server-only"

import { outboundAllowed } from "@/lib/app-mode"

export type FeedbackMailConfig = {
  apiKey: string
  from: string
}

/** Null when Resend is not configured. The note is still saved. */
export function feedbackMailConfig(): FeedbackMailConfig | null {
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? ""
  const from = (process.env.EMAIL_FROM ?? process.env.INVOICE_FROM_EMAIL)?.trim() ?? ""
  if (apiKey === "" || from === "") {
    return null
  }
  return { apiKey, from }
}

export async function sendFeedbackNotice(input: {
  to: string[]
  subject: string
  text: string
}): Promise<boolean> {
  const config = feedbackMailConfig()
  if (!config || input.to.length === 0) {
    return false
  }
  if (!outboundAllowed("email")) {
    return false
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: config.from,
        to: input.to,
        subject: input.subject,
        text: input.text,
      }),
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) {
      console.error("Feedback email was not sent.", response.status)
      return false
    }
    return true
  } catch (error) {
    console.error(
      "Feedback email was not sent.",
      error instanceof Error ? error.message : "request failed",
    )
    return false
  }
}
