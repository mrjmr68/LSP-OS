import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { VisitFlow } from "@/components/visit/visit-flow"
import { loadVisit } from "@/lib/visit-data"

export const metadata: Metadata = {
  title: "Visit",
}

export default async function VisitPage({
  params,
}: {
  params: Promise<{ requestId: string }>
}) {
  const { requestId } = await params
  const result = await loadVisit(requestId)
  if (!result.ok && result.message === "Sign in again to load the board.") {
    redirect("/login")
  }

  return (
    <VisitFlow
      model={result.ok ? result.model : null}
      bundles={result.ok ? result.bundles : []}
      suppliers={result.ok ? result.suppliers : []}
      error={result.ok ? null : result.message}
    />
  )
}
