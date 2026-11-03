"use server"

import { headers } from "next/headers"

import { sendFeedbackNotice } from "@/lib/feedback-mail"
import {
  feedbackDraftError,
  feedbackNoticeRecipients,
  feedbackNoticeText,
  isFeedbackKind,
  storedFeedbackContext,
  type FeedbackContextInput,
  type FeedbackKind,
  type StoredFeedbackContext,
} from "@/lib/feedback"
import { isSupabaseConfigured } from "@/lib/env"
import { createClient } from "@/lib/supabase/server"

export type FeedbackActionResult =
  | { ok: true; data: { id: string } }
  | { ok: false; message: string }

export async function submitFeedback(input: {
  kind: FeedbackKind
  body: string
  context: FeedbackContextInput
}): Promise<FeedbackActionResult> {
  const draftError = feedbackDraftError(input.kind, input.body)
  if (draftError || !isFeedbackKind(input.kind)) {
    return { ok: false, message: draftError ?? "Pick a type." }
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, message: "Supabase is not connected yet." }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, message: "Sign in again to send this." }
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("auth_user_id", user.id)
    .eq("active", true)
    .maybeSingle()

  if (profileError || !profile) {
    return { ok: false, message: "This login is not on the crew list yet." }
  }

  const headerStore = await headers()
  const context = storedFeedbackContext(input.context, headerStore.get("user-agent"))
  await keepVisibleRequest(supabase, context)
  const body = input.body.trim()
  const typedProfile = profile as { id: string; full_name: string }

  const { data: inserted, error: insertError } = await supabase
    .from("app_feedback")
    .insert({
      created_by: typedProfile.id,
      kind: input.kind,
      body,
      context,
    })
    .select("id")
    .single()

  if (insertError || !inserted) {
    return { ok: false, message: actionMessage(insertError?.message ?? "Could not save.") }
  }

  const saved = inserted as { id: string }
  await notifyOwners(supabase, {
    id: saved.id,
    kind: input.kind,
    body,
    submitterName: typedProfile.full_name,
    context,
  })

  return { ok: true, data: { id: saved.id } }
}

async function keepVisibleRequest(
  supabase: Awaited<ReturnType<typeof createClient>>,
  context: StoredFeedbackContext,
): Promise<void> {
  if (!context.request_id) {
    return
  }
  const { data, error } = await supabase
    .from("service_requests")
    .select("display_number")
    .eq("id", context.request_id)
    .is("deleted_at", null)
    .maybeSingle()
  const row = data as { display_number: string } | null
  if (error || !row) {
    context.request_id = null
    context.display_number = null
    return
  }
  context.display_number = row.display_number
}

async function notifyOwners(
  supabase: Awaited<ReturnType<typeof createClient>>,
  note: {
    id: string
    kind: FeedbackKind
    body: string
    submitterName: string
    context: ReturnType<typeof storedFeedbackContext>
  },
): Promise<void> {
  try {
    const { data: owners } = await supabase
      .from("profiles")
      .select("email")
      .eq("role", "owner")
      .eq("active", true)

    const recipients = feedbackNoticeRecipients(
      ((owners ?? []) as { email: string | null }[])
        .map((owner) => owner.email ?? "")
        .filter((email) => email !== ""),
    )
    const summary = `${note.context.path} · ${note.context.filter === "mine" ? "My jobs" : "All jobs"}${
      note.context.display_number ? ` · ${note.context.display_number}` : ""
    }`
    const message = feedbackNoticeText({
      kind: note.kind,
      body: note.body,
      submitterName: note.submitterName,
      summary,
      userAgent: note.context.user_agent,
    })
    const sent = await sendFeedbackNotice({
      to: recipients,
      subject: message.subject,
      text: message.text,
    })
    if (!sent) {
      return
    }
    const { error } = await supabase.rpc("mark_app_feedback_emailed", {
      feedback_id: note.id,
    })
    if (error) {
      console.error("Feedback was emailed but the sent time was not saved.")
    }
  } catch (error) {
    console.error(
      "Feedback was saved. The email step failed.",
      error instanceof Error ? error.message : "request failed",
    )
  }
}

function actionMessage(message: string): string {
  const line = message.split("\n")[0]?.replace(/^ERROR:\s+\w+:\s*/, "") ?? message
  if (/relation |schema cache|stack|jwt|permission denied for/i.test(line)) {
    return "Could not save. Apply the latest database migration, then try again."
  }
  return line.slice(0, 240)
}
