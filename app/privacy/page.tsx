import type { Metadata } from "next"

import { PublicPage } from "@/components/public-page"
import { SMS_BRAND, SMS_SUPPORT_PHONE } from "@/lib/sms-consent"

export const metadata: Metadata = {
  title: "Privacy Policy",
}

export default function PrivacyPage() {
  return (
    <PublicPage title="Privacy Policy">
      <div className="flex flex-col gap-4 text-sm leading-6">
        <p className="text-muted-foreground">Effective November 19, 2026</p>
        <p>
          {SMS_BRAND} (&quot;Legend Service Pros&quot;, &quot;we&quot;) provides
          HVAC repair service to apartment communities in North Carolina. This
          policy explains what we collect and how we use it.
        </p>
        <h2 className="font-display text-xl tracking-wide">What we collect</h2>
        <p>
          Names, phone numbers and email addresses of property managers and
          maintenance staff; property and unit details; service requests,
          photos and readings taken on site; and invoice records.
        </p>
        <h2 className="font-display text-xl tracking-wide">How we use it</h2>
        <p>
          To schedule and perform service, keep equipment history, send
          estimates and invoices, and send service-update texts to people who
          have agreed to receive them.
        </p>
        <h2 className="font-display text-xl tracking-wide">Text messages</h2>
        <p>
          No mobile information will be shared with third parties or affiliates
          for marketing or promotional purposes. Text messaging opt-in data and
          consent are not shared with any third parties. We use a texting
          provider only to deliver our messages. Reply STOP to any message to
          opt out.
        </p>
        <h2 className="font-display text-xl tracking-wide">Sharing</h2>
        <p>
          We do not sell personal information. We share it only with service
          providers that run our software, hosting and messaging, and when the
          law requires it.
        </p>
        <h2 className="font-display text-xl tracking-wide">Contact</h2>
        <p>
          Questions or requests to update or remove your information: call or
          text {SMS_SUPPORT_PHONE}.
        </p>
      </div>
    </PublicPage>
  )
}
