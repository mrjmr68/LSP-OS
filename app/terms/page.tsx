import type { Metadata } from "next"
import Link from "next/link"

import { PublicPage } from "@/components/public-page"
import { SMS_BRAND, SMS_SUPPORT_PHONE } from "@/lib/sms-consent"

export const metadata: Metadata = {
  title: "Terms and Conditions",
}

export default function TermsPage() {
  return (
    <PublicPage title="Terms and Conditions">
      <div className="flex flex-col gap-4 text-sm leading-6">
        <p className="text-muted-foreground">Effective November 19, 2026</p>
        <p>
          These Terms and Conditions apply to the text message program run by
          {" "}Legend Service Pros LLC, an HVAC service company in Greensboro,
          North Carolina.
        </p>
        <h2 className="font-display text-xl tracking-wide">
          SMS Terms of Service
        </h2>
        <p>
          <strong>Program:</strong> {SMS_BRAND} service updates. We text property
          managers, maintenance staff and our technicians about HVAC service
          requests: technician on the way with an arrival time, job complete,
          estimate ready, and questions about a job.
        </p>
        <p>
          <strong>Frequency:</strong> message frequency varies with your
          service activity. Msg &amp; data rates may apply.
        </p>
        <p>
          <strong>Opt out:</strong> reply STOP to any message. You will get one
          message confirming you are unsubscribed, then no more texts.
        </p>
        <p>
          <strong>Help:</strong> reply HELP, or call {SMS_SUPPORT_PHONE}.
        </p>
        <p>
          Consent to texts is not a condition of service. Carriers are not
          liable for delayed or undelivered messages.
        </p>
        <p>
          See our{" "}
          <Link href="/privacy" className="font-medium underline">
            Privacy Policy
          </Link>{" "}
          for how we handle your information.
        </p>
      </div>
    </PublicPage>
  )
}
