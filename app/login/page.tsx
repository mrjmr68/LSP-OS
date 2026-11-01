import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { LoginForm } from "@/components/login-form"
import { isSupabaseConfigured } from "@/lib/env"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = {
  title: "Sign in",
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const params = await searchParams
  const configured = isSupabaseConfigured()

  if (configured) {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) {
      redirect("/board")
    }
  }

  return (
    <main className="min-h-full">
      <div className="bg-primary px-4 py-6 text-primary-foreground">
        <p className="font-display text-4xl leading-none font-bold tracking-wide">
          LSP
        </p>
        <p className="mt-2 text-sm text-primary-foreground/80">
          Legend Service Pros
        </p>
      </div>
      <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-wide">
            Sign in
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Owners and techs use the same Board. Accounts are created by an
            owner. There is no public sign-up.
          </p>
        </div>

        {params.error === "auth" ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            That sign-in link expired or was already used. Enter your email
            and password.
          </p>
        ) : null}

        {configured ? <LoginForm /> : <SetupChecklist />}
      </div>
    </main>
  )
}

function SetupChecklist() {
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
      <h2 className="font-display text-xl tracking-wide">Before sign-in works</h2>
      <ol className="list-decimal space-y-3 pl-5 text-sm leading-6">
        <li>Create a Supabase project and run the SQL in supabase/migrations.</li>
        <li>
          Put the project URL and anon key in .env.local, then restart the dev
          server.
        </li>
        <li>
          In Authentication, turn off public sign-up and add each person.
        </li>
        <li>
          In the SQL editor, set role to owner for the three owner-technicians.
          Everyone else stays tech.
        </li>
      </ol>
      <Link
        href="/board"
        className="inline-flex min-h-12 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
      >
        Open the Board shell
      </Link>
    </section>
  )
}
