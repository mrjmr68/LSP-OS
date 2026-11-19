import type { Metadata } from "next"

import { PublicPage } from "@/components/public-page"
import { TextUpdatesForm } from "@/components/text-updates-form"

export const metadata: Metadata = {
  title: "Text updates",
}

export default function TextUpdatesPage() {
  return (
    <PublicPage title="Get text updates">
      <p className="text-sm leading-6 text-muted-foreground">
        Property managers and maintenance staff: get a text when our technician
        is on the way, when a job is done, and when an estimate is ready.
      </p>
      <TextUpdatesForm />
    </PublicPage>
  )
}
