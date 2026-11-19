"use server"

import { revalidatePath } from "next/cache"

import { isSupabaseConfigured } from "@/lib/env"
import { isUuid } from "@/lib/setup"
import { createClient } from "@/lib/supabase/server"

/** The tech answers an owner's question on a draft invoice. */
export async function answerQuestion(
  invoiceId: string,
  answer: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isSupabaseConfigured()) return { ok: false, message: "The database is not connected." }
  if (!isUuid(invoiceId)) return { ok: false, message: "Reload My jobs." }
  const supabase = await createClient()
  const { error } = await supabase.rpc("answer_invoice_question", { invoice_id: invoiceId, answer })
  if (error) {
    return {
      ok: false,
      message: /fetch failed|network/i.test(error.message)
        ? "No connection. Try again when you have signal."
        : error.message,
    }
  }
  revalidatePath("/board")
  revalidatePath("/review", "layout")
  return { ok: true }
}
