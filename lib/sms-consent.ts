/**
 * SMS consent wording and phone checks for the text-updates sign-up page.
 * The exact wording is stored with every consent record, so change
 * SMS_CONSENT_VERSION whenever SMS_CONSENT_TEXT changes.
 */

export const SMS_BRAND = "Legend Service Pros LLC"
export const SMS_SUPPORT_PHONE = "(336) 962-2050"

export const SMS_CONSENT_VERSION = "2026-11-19.2"

export const SMS_CONSENT_TEXT =
  "Yes, text me service updates from Legend Service Pros LLC about HVAC service " +
  "requests at my property, such as a technician on the way, a job complete, or " +
  "an estimate ready. Message frequency varies. Msg & data rates may apply. " +
  "Reply STOP to opt out at any time, HELP for help. Consent is not a condition " +
  "of service. See our Privacy Policy and Terms and Conditions."

/** Returns +1XXXXXXXXXX for a valid US number, otherwise null. */
export function normalizeUsMobile(raw: string): string | null {
  const digits = raw.replace(/\D/g, "")
  const ten =
    digits.length === 11 && digits.startsWith("1")
      ? digits.slice(1)
      : digits.length === 10
        ? digits
        : null
  if (!ten || !/^[2-9]/.test(ten)) {
    return null
  }
  return `+1${ten}`
}
