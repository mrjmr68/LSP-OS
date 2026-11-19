"use client"

import Link from "next/link"
import { useActionState } from "react"

import {
  requestPasswordReset,
  setNewPassword,
  type PasswordState,
} from "@/app/actions/password"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const initial: PasswordState = { error: null, done: false }

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, initial)
  if (state.done) {
    return (
      <p role="status" className="rounded-xl border border-border bg-card p-4 text-sm leading-6">
        If that email has an LSP account, a sign-in link is on its way. Open it on this device,
        then choose a new password.
      </p>
    )
  }
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required className="h-12 text-base" />
      </div>
      {state.error ? (
        <p role="alert" className="text-sm font-medium text-destructive">{state.error}</p>
      ) : null}
      <Button type="submit" size="field" disabled={pending} className="w-full">
        {pending ? "Sending…" : "Email me a sign-in link"}
      </Button>
    </form>
  )
}

export function NewPasswordForm() {
  const [state, action, pending] = useActionState(setNewPassword, initial)
  if (state.done) {
    return (
      <div role="status" className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 text-sm leading-6">
        <p>Password saved. Use it next time you sign in.</p>
        <Link href="/board" className="inline-flex min-h-12 items-center justify-center rounded-lg bg-primary px-4 font-medium text-primary-foreground">
          Go to the Board
        </Link>
      </div>
    )
  }
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">New password</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required className="h-12 text-base" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirm">Type it again</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={8} required className="h-12 text-base" />
      </div>
      {state.error ? (
        <p role="alert" className="text-sm font-medium text-destructive">{state.error}</p>
      ) : null}
      <Button type="submit" size="field" disabled={pending} className="w-full">
        {pending ? "Saving…" : "Save new password"}
      </Button>
    </form>
  )
}
