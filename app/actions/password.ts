"use server"

import { headers } from "next/headers"

import { isSupabaseConfigured } from "@/lib/env"
import { createClient } from "@/lib/supabase/server"

export type PasswordState = { error: string | null; done: boolean }

/** Emails a sign-in link that lands on the set-a-new-password page. */
export async function requestPasswordReset(
  _state: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const email = String(formData.get("email") ?? "").trim()
  if (!email.includes("@")) return { error: "Enter your email.", done: false }
  if (!isSupabaseConfigured()) return { error: "Sign-in is not set up yet.", done: false }

  const h = await headers()
  const host = h.get("x-forwarded-host") ?? h.get("host")
  const proto = h.get("x-forwarded-proto") ?? "https"
  const supabase = await createClient()
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${proto}://${host}/auth/callback?next=/account/password`,
  })
  // Same answer whether or not the email has an account.
  return { error: null, done: true }
}

export async function setNewPassword(
  _state: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const password = String(formData.get("password") ?? "")
  const confirm = String(formData.get("confirm") ?? "")
  if (password.length < 8) return { error: "Use at least 8 characters.", done: false }
  if (password !== confirm) return { error: "The two passwords don't match.", done: false }
  if (!isSupabaseConfigured()) return { error: "Sign-in is not set up yet.", done: false }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "That link expired. Ask for a new one.", done: false }
  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    return {
      error: error.message.toLowerCase().includes("weak") || error.message.toLowerCase().includes("pwned")
        ? "That password is too easy to guess. Try a longer one."
        : "That didn't save. Try again.",
      done: false,
    }
  }
  return { error: null, done: true }
}
