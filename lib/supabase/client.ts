import { createBrowserClient } from "@supabase/ssr"

import { supabaseAnonKey, supabaseUrl } from "@/lib/env"

/** Browser Supabase client. Session cookies are shared with the server client. */
export function createClient() {
  return createBrowserClient(supabaseUrl(), supabaseAnonKey())
}
