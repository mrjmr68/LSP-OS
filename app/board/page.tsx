import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { BoardShell } from "@/components/board/board-shell"
import { loadBoard } from "@/lib/board-data"
import { isSupabaseConfigured } from "@/lib/env"

export const metadata: Metadata = {
  title: "Board",
}

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  const [result, params] = await Promise.all([loadBoard(), searchParams])
  const view = params.view === "mine" ? "mine" : params.view === "board" ? "board" : undefined

  if (!result.ok && result.message === "Sign in again to load the board.") {
    redirect("/login")
  }

  if (!result.ok) {
    return (
      <BoardShell
        viewer={result.viewer}
        cards={[]}
        catalog={{ contacts: [], properties: [], links: [], crew: [] }}
        catalogError={null}
        profileMissing={false}
        loadError={result.message}
        initialView={view}
      />
    )
  }

  if (result.viewer.mode === "preview" && isSupabaseConfigured()) {
    redirect("/login")
  }

  return (
    <BoardShell
      viewer={result.viewer}
      cards={result.cards}
      catalog={result.catalog}
      catalogError={result.catalogError}
      profileMissing={result.profileMissing}
      loadError={null}
      initialView={view}
      review={result.review}
    />
  )
}
