import assert from "node:assert/strict"
import { test } from "node:test"

import { normalizeUsMobile, SMS_CONSENT_TEXT } from "./sms-consent"

test("normalizes common US formats", () => {
  assert.equal(normalizeUsMobile("(336) 555-0123"), "+13365550123")
  assert.equal(normalizeUsMobile("336.555.0123"), "+13365550123")
  assert.equal(normalizeUsMobile("+1 336 555 0123"), "+13365550123")
  assert.equal(normalizeUsMobile("13365550123"), "+13365550123")
})

test("rejects numbers that are not US mobiles", () => {
  assert.equal(normalizeUsMobile("555-0123"), null)
  assert.equal(normalizeUsMobile("1365550123"), null)
  assert.equal(normalizeUsMobile("+44 20 7946 0958"), null)
  assert.equal(normalizeUsMobile(""), null)
})

test("consent wording carries the carrier-required pieces", () => {
  for (const piece of [
    "Legend Service Pros LLC",
    "Message frequency varies",
    "Msg & data rates may apply",
    "STOP",
    "HELP",
    "not a condition",
    "Privacy Policy",
  ]) {
    assert.ok(SMS_CONSENT_TEXT.includes(piece), `missing: ${piece}`)
  }
})
