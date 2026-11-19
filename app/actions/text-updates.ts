"use server"

import { isSupabaseConfigured } from "@/lib/env"
import {
  normalizeUsMobile,
  SMS_CONSENT_TEXT,
  SMS_CONSENT_VERSION,
} from "@/lib/sms-consent"
import { createClient } from "@/lib/supabase/server"

export type TextUpdatesState = {
  error: string | null
  done: boolean
}

// Public action: no sign-in required. The database function only inserts
// a consent row and validates every field again.
export async function signUpForTextUpdates(
  _state: TextUpdatesState,
  formData: FormData,
): Promise<TextUpdatesState> {
  const name = String(formData.get("name") ?? "").trim()
  const property = String(formData.get("property") ?? "").trim()
  const mobile = normalizeUsMobile(String(formData.get("mobile") ?? ""))
  const agreed = formData.get("consent") === "yes"

  if (!name) {
    return { error: "Enter your name.", done: false }
  }
  if (!mobile) {
    return { error: "Enter a 10-digit US mobile number.", done: false }
  }
  if (!agreed) {
    return { error: "Check the box to agree to text updates.", done: false }
  }
  if (!isSupabaseConfigured()) {
    return { error: "Sign-up is not available right now.", done: false }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc("record_sms_consent", {
    p_full_name: name.slice(0, 120),
    p_mobile_e164: mobile,
    p_property_name: property.slice(0, 120),
    p_consent_text: SMS_CONSENT_TEXT,
    p_consent_version: SMS_CONSENT_VERSION,
  })

  if (error) {
    return { error: "That didn't save. Please try again.", done: false }
  }
  return { error: null, done: true }
}
