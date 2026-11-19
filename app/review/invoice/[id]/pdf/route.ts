import { NextResponse, type NextRequest } from "next/server"

import { isSupabaseConfigured } from "@/lib/env"
import { loadInvoiceDocument, renderInvoicePdf } from "@/lib/invoice-pdf"
import { isUuid } from "@/lib/setup"
import { createClient } from "@/lib/supabase/server"

/** The approved invoice as a PDF, for owners. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/review/invoice/[id]/pdf">) {
  const { id } = await ctx.params
  if (!isUuid(id) || !isSupabaseConfigured()) return new NextResponse("Not found", { status: 404 })
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new NextResponse("Sign in again.", { status: 401 })
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, active")
    .eq("auth_user_id", user.id)
    .maybeSingle()
  const p = profile as { role: string; active: boolean } | null
  if (!p?.active || p.role !== "owner") return new NextResponse("Owners only.", { status: 403 })

  const doc = await loadInvoiceDocument(supabase, id)
  if (!doc) return new NextResponse("This invoice has no PDF until it is approved.", { status: 404 })
  const pdf = await renderInvoicePdf(doc)
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="LSP invoice ${doc.number}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  })
}
