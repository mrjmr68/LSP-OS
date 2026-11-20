"use client"

import { Button } from "@/components/ui/button"

export default function PartsError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex max-w-md flex-col gap-4 py-6">
      <h1 className="font-display text-3xl font-semibold tracking-wide">Parts did not load</h1>
      <p className="text-sm leading-6 text-muted-foreground">
        The part orders could not be read. Check the connection, then try again.
      </p>
      <Button type="button" size="field" onClick={reset}>
        Try again
      </Button>
    </div>
  )
}
