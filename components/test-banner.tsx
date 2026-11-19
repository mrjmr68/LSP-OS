import { isTestMode } from "@/lib/app-mode"

/** Shown on every page of a preview link or local copy. */
export function TestBanner() {
  if (!isTestMode()) {
    return null
  }
  return (
    <div
      role="status"
      className="bg-high px-4 py-1.5 text-center text-xs font-bold tracking-wide text-high-foreground uppercase"
    >
      Test copy · real data · no texts or emails go out
    </div>
  )
}
