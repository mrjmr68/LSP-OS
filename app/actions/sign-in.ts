"use server"

import { redirect } from "next/navigation"

import { isSupabaseConfigured } from "@/lib/env"
import { createClient } from "@/lib/supabase/server"

export type SignInState = {
  error: string | null
}

export async function signIn(
  _state: SignInState,
  formData: FormData,
): Promise<SignInState> {
  if (!isSupabaseConfigured()) {
    return {
      error: "Supabase is not configured yet. Add the project URL and anon key.",
    }
  }

  const email = String(formData.get("email") ?? "").trim()
  const password = String(formData.get("password") ?? "")

  if (!email || !password) {
    return { error: "Email and password are both required." }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return { error: "Email or password does not match." }
  }

  redirect("/board")
}
