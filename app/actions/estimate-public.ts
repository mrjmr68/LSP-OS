"use server"

import { revalidatePath } from "next/cache"

import { isSupabaseConfigured } from "@/lib/env"
import { createClient } from "@/lib/supabase/server"

export type AnswerResult =
  { ok: true; status: "accepted" | "declined" } | { ok: false; message: string }

/** The property approves or declines on its link. No sign-in; the token is the key. */
export async function answerEstimate(
  token: string,
  approve: boolean,
  name: string,
  note: string,
): Promise<AnswerResult> {
  if (!isSupabaseConfigured())
    return { ok: false, message: "This page isn't available right now. Call us." }
  if (!/^[0-9a-f-]{20,64}$/i.test(token))
    return { ok: false, message: "That estimate link isn't valid." }
  if (approve && name.trim() === "") return { ok: false, message: "Type your name to approve." }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("respond_to_estimate", {
    token,
    approve,
    name: name.trim().slice(0, 120) || null,
    note: note.trim().slice(0, 1000) || null,
  })
  if (error) {
    return {
      ok: false,
      message: /fetch failed|network/i.test(error.message)
        ? "No connection. Try again."
        : error.message,
    }
  }
  revalidatePath(`/e/${token}`)
  const status =
    (data as { status: "accepted" | "declined" } | null)?.status ??
    (approve ? "accepted" : "declined")
  return { ok: true, status }
}
