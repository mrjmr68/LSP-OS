import type { Metadata } from "next"

import { TeamList } from "@/components/setup/team-editor"
import { loadTeam, requireOwner } from "@/lib/setup-data"

export const metadata: Metadata = { title: "Team" }

export default async function SetupTeamPage() {
  const supabase = await requireOwner()
  const people = await loadTeam(supabase)
  const active = people.filter((p) => p.active)
  const inactive = people.filter((p) => !p.active)
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-wide">Team</h1>
        <p className="mt-1 max-w-prose text-sm leading-6 text-muted-foreground">
          Everyone who signs in. Owners see the whole Board, review invoices and use Setup.
          Turning off &quot;Can sign in&quot; locks someone out but keeps their past jobs.
          There must always be at least one active owner.
        </p>
      </div>
      <TeamList people={active} />
      {inactive.length > 0 ? (
        <>
          <h2 className="mt-4 font-display text-xl tracking-wide">No longer signing in</h2>
          <TeamList people={inactive} />
        </>
      ) : null}
      <p className="text-sm text-muted-foreground">
        Adding a new person by email invite is coming next.
      </p>
    </div>
  )
}
