import type { Metadata } from "next"
import Link from "next/link"

import { PublicPage } from "@/components/public-page"
import { ForgotPasswordForm } from "@/components/password-forms"

export const metadata: Metadata = { title: "Forgot password" }

export default function ForgotPasswordPage() {
  return (
    <PublicPage title="Forgot password">
      <p className="text-sm leading-6 text-muted-foreground">
        Enter the email you sign in with. We&apos;ll send a link that signs you in so you can
        choose a new password.
      </p>
      <ForgotPasswordForm />
      <Link href="/login" className="text-sm underline">Back to sign in</Link>
    </PublicPage>
  )
}
