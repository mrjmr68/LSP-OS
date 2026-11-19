import type { Metadata, Viewport } from "next"
import { Atkinson_Hyperlegible, Barlow_Condensed } from "next/font/google"

import { PwaRegister } from "@/components/pwa-register"
import { TestBanner } from "@/components/test-banner"

import "./globals.css"

const sans = Atkinson_Hyperlegible({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-atkinson",
})

const display = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-barlow",
})

export const metadata: Metadata = {
  title: {
    default: "LSP",
    template: "%s · LSP",
  },
  description: "Legend Service Pros operating system. The Board is the truth.",
  applicationName: "Legend Service Pros",
  appleWebApp: {
    capable: true,
    title: "LSP",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
}

export const viewport: Viewport = {
  themeColor: "#1c3330",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${display.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background text-foreground">
        <TestBanner />
        <PwaRegister />
        {children}
      </body>
    </html>
  )
}
