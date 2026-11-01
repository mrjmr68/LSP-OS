"use client"

import { Button } from "@/components/ui/button"

export default function BoardError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-col gap-4 px-4 py-10">
      <p className="font-display text-2xl font-bold tracking-wide">LSP</p>
      <h1 className="font-display text-3xl font-semibold tracking-wide">
        The board did not load
      </h1>
      <p className="text-sm leading-6 text-muted-foreground">
        The call list could not be read. Check the connection, then try again.
      </p>
      <Button type="button" size="field" onClick={reset}>
        Try again
      </Button>
    </main>
  )
}
