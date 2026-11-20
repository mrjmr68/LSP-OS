import type { Metadata } from "next"
import { connection } from "next/server"

import { EstimateLinkView, type EstimateShown } from "@/components/estimate-link-view"
import { PublicPage } from "@/components/public-page"
import { isSupabaseConfigured } from "@/lib/env"
import { COMPANY } from "@/lib/invoice-pdf"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = { title: "Estimate", robots: { index: false, follow: false } }

/** The property's estimate: what we found, the price, Approve or Decline. */
export default async function EstimateLinkPage({ params }: PageProps<"/e/[token]">) {
  await connection()
  const { token } = await params
  let est: EstimateShown | null = null
  if (isSupabaseConfigured() && /^[0-9a-f-]{20,64}$/i.test(token)) {
    const supabase = await createClient()
    const { data } = await supabase.rpc("estimate_by_token", { token })
    est = (data as EstimateShown | null) ?? null
  }
  if (!est) {
    return (
      <PublicPage title="Estimate not found">
        <p className="text-base leading-7 text-muted-foreground">
          This link doesn&apos;t match an estimate. Check the link in your email, or call us
          {COMPANY.phone ? ` at ${COMPANY.phone}` : ""}.
        </p>
      </PublicPage>
    )
  }
  return <EstimateLinkView est={est} token={token} />
}
