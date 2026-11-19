"use client"

import Link from "next/link"
import { useActionState } from "react"

import {
  signUpForTextUpdates,
  type TextUpdatesState,
} from "@/app/actions/text-updates"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SMS_CONSENT_TEXT } from "@/lib/sms-consent"

const initialState: TextUpdatesState = { error: null, done: false }

// Split the stored wording so the last sentence can carry links.
const [CONSENT_LEAD] = SMS_CONSENT_TEXT.split(" See our Privacy Policy")

export function TextUpdatesForm() {
  const [state, formAction, pending] = useActionState(
    signUpForTextUpdates,
    initialState,
  )

  if (state.done) {
    return (
      <div
        role="status"
        className="rounded-xl border border-border bg-card p-4 text-sm leading-6"
      >
        <p className="font-medium">You&apos;re signed up.</p>
        <p className="mt-1 text-muted-foreground">
          You&apos;ll get service-update texts from Legend Service Pros. Reply
          STOP to any message to opt out.
        </p>
      </div>
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Your name</Label>
        <Input
          id="name"
          name="name"
          autoComplete="name"
          required
          className="h-12 text-base"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="mobile">Mobile number</Label>
        <Input
          id="mobile"
          name="mobile"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="(336) 555-0123"
          required
          className="h-12 text-base"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="property">Property (optional)</Label>
        <Input
          id="property"
          name="property"
          placeholder="e.g. Abbey Crossing"
          className="h-12 text-base"
        />
      </div>

      <label className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-sm leading-6">
        <input
          type="checkbox"
          name="consent"
          value="yes"
          required
          className="mt-1 size-5 shrink-0 accent-primary"
        />
        <span>
          {CONSENT_LEAD} See our{" "}
          <Link href="/privacy" className="font-medium underline">
            Privacy Policy
          </Link>{" "}
          and{" "}
          <Link href="/terms" className="font-medium underline">
            SMS Terms
          </Link>
          .
        </span>
      </label>

      {state.error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" size="field" disabled={pending} className="w-full">
        {pending ? "Signing up…" : "Sign up for text updates"}
      </Button>
    </form>
  )
}
