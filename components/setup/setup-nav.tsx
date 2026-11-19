"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Suspense } from "react"

const SECTIONS = [
  { href: "/setup/properties", label: "Properties" },
  { href: "/setup/contacts", label: "Contacts" },
  { href: "/setup/customers", label: "Customers" },
  { href: "/setup/suppliers", label: "Suppliers" },
  { href: "/setup/team", label: "Team" },
  { href: "/setup/tax-rates", label: "Tax rates" },
] as const

/** The highlight needs the current address, so it streams in after the page shell. */
export function SetupNav() {
  return (
    <Suspense fallback={<NavLinks pathname="" />}>
      <CurrentNav />
    </Suspense>
  )
}

function CurrentNav() {
  return <NavLinks pathname={usePathname()} />
}

function NavLinks({ pathname }: { pathname: string }) {
  return (
    <nav aria-label="Setup sections" className="flex gap-1 overflow-x-auto">
      {SECTIONS.map((s) => {
        const current = pathname.startsWith(s.href)
        return (
          <Link
            key={s.href}
            href={s.href}
            aria-current={current ? "page" : undefined}
            className={
              "flex min-h-11 items-center rounded-lg px-3 text-sm font-medium whitespace-nowrap " +
              (current
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground")
            }
          >
            {s.label}
          </Link>
        )
      })}
    </nav>
  )
}
