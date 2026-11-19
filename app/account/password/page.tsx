import type { Metadata } from "next"

import { PublicPage } from "@/components/public-page"
import { NewPasswordForm } from "@/components/password-forms"

export const metadata: Metadata = { title: "New password" }

export default function NewPasswordPage() {
  return (
    <PublicPage title="Choose a new password">
      <p className="text-sm leading-6 text-muted-foreground">
        At least 8 characters. A short phrase is easier to remember than a jumble.
      </p>
      <NewPasswordForm />
    </PublicPage>
  )
}
