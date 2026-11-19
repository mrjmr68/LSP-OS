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
      <div className="bg-primary px-4 py-6 text-primary-foreground">
        <p className="font-display text-4xl leading-none font-bold tracking-wide">
          LSP
        </p>
        <p className="mt-2 text-sm text-primary-foreground/80">
          Legend Service Pros · HVAC service for apartment communities
        </p>
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
