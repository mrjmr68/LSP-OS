import Link from "next/link"

/** Shell for the signed-out pages (text updates, privacy, SMS terms). */
export function PublicPage({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <main className="min-h-full">
      <div className="border-b-4 border-[#f1e3c8] bg-card px-4 py-5">
        <div className="mx-auto w-full max-w-md">
          {/* eslint-disable-next-line @next/next/no-img-element -- a static SVG logo */}
          <img src="/brand/lsp-logo.svg" alt="Legend Service Pros" width={176} height={51} className="h-auto w-44" />
          <p className="mt-2 text-sm text-muted-foreground">
            Legend Service Pros · HVAC service for apartment communities
          </p>
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
        <h1 className="font-display text-3xl font-semibold tracking-wide">
          {title}
        </h1>
        {children}
        <nav className="flex gap-4 border-t border-border pt-4 text-sm text-muted-foreground">
          <Link href="/text-updates" className="underline">
            Text updates
          </Link>
          <Link href="/privacy" className="underline">
            Privacy Policy
          </Link>
          <Link href="/terms" className="underline">
            Terms and Conditions
          </Link>
        </nav>
      </div>
    </main>
  )
}
