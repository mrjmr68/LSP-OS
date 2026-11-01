import "server-only"

import { connection } from "next/server"

import {
  ageLabel,
  type BoardCard,
  type BoardViewer,
  compareBoardCards,
  isBoardStatus,
  sourceLabel,
} from "@/lib/board"
import { isSupabaseConfigured } from "@/lib/env"
import { createClient } from "@/lib/supabase/server"

export type BoardLoad =
  | {
      ok: true
      viewer: BoardViewer
      cards: BoardCard[]
      profileMissing: boolean
    }
  | {
      ok: false
      viewer: BoardViewer
      message: string
    }

type ProfileRow = {
  id: string
  full_name: string
  role: "owner" | "tech"
  email: string
  active: boolean
}

type RequestRow = {
  id: string
  display_number: string
  issue: string
  board_status: string
  priority: "normal" | "high"
  assigned_user_id: string | null
  created_at: string
  board_sort_bumped_at: string | null
  source: string
  properties: { name: string } | { name: string }[] | null
  units: { unit_label: string } | { unit_label: string }[] | null
  assignee: { full_name: string } | { full_name: string }[] | null
}

const previewViewer: BoardViewer = {
  mode: "preview",
  profileId: null,
  fullName: "Preview",
  role: null,
  email: null,
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) {
    return null
  }
  return Array.isArray(value) ? (value[0] ?? null) : value
}

export async function loadBoard(): Promise<BoardLoad> {
  await connection()

  if (!isSupabaseConfigured()) {
    return {
      ok: true,
      viewer: previewViewer,
      cards: [],
      profileMissing: false,
    }
  }

  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return {
      ok: false,
      viewer: previewViewer,
      message: "Sign in again to load the board.",
    }
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, role, email, active")
    .eq("auth_user_id", user.id)
    .maybeSingle()

  if (profileError) {
    return {
      ok: false,
      viewer: {
        mode: "authenticated",
        profileId: null,
        fullName: user.email ?? "Signed in",
        role: null,
        email: user.email ?? null,
      },
      message: databaseMessage(profileError.message),
    }
  }

  const typedProfile = profile as ProfileRow | null
  const viewer: BoardViewer = {
    mode: "authenticated",
    profileId: typedProfile?.active ? typedProfile.id : null,
    fullName: typedProfile?.full_name ?? user.email ?? "Signed in",
    role: typedProfile?.active ? typedProfile.role : null,
    email: typedProfile?.email ?? user.email ?? null,
  }

  const { data, error } = await supabase
    .from("service_requests")
    .select(
      `
        id,
        display_number,
        issue,
        board_status,
        priority,
        assigned_user_id,
        created_at,
        board_sort_bumped_at,
        source,
        properties ( name ),
        units ( unit_label ),
        assignee:profiles!service_requests_assigned_user_id_fkey ( full_name )
      `,
    )
    .is("deleted_at", null)

  if (error) {
    return {
      ok: false,
      viewer,
      message: databaseMessage(error.message),
    }
  }

  const now = Date.now()
  const cards = ((data ?? []) as RequestRow[])
    .flatMap((row) => {
      if (!isBoardStatus(row.board_status)) {
        return []
      }
      const property = one(row.properties)
      const unit = one(row.units)
      const assignee = one(row.assignee)
      const card: BoardCard = {
        id: row.id,
        displayNumber: row.display_number,
        issue: row.issue,
        status: row.board_status,
        priority: row.priority,
        assignedUserId: row.assigned_user_id,
        assigneeName: assignee?.full_name ?? null,
        propertyName: property?.name ?? "Property",
        unitLabel: unit?.unit_label ?? "Unit",
        sourceLabel: sourceLabel(row.source),
        ageLabel: ageLabel(row.created_at, now),
        bumpedAtMs: row.board_sort_bumped_at
          ? Date.parse(row.board_sort_bumped_at)
          : null,
        createdAtMs: Date.parse(row.created_at),
      }
      return [card]
    })
    .sort(compareBoardCards)

  return {
    ok: true,
    viewer,
    cards,
    profileMissing: !typedProfile?.active,
  }
}

function databaseMessage(message: string): string {
  if (
    /relation .* does not exist|schema cache|Could not find the table/i.test(
      message,
    )
  ) {
    return "The database is missing the LSP tables. Apply supabase/migrations, then refresh."
  }
  return "Could not load the board. Check the Supabase connection and try again."
}
