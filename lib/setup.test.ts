import assert from "node:assert/strict"
import { test } from "node:test"

import {
  formatRate,
  matchesProperty,
  parseRatePercent,
  validateProperty,
  type PropertyInput,
} from "./setup"

const base: PropertyInput = {
  customerId: "11111111-1111-4111-8111-111111111111",
  name: "Abbey Crossing",
  addressLine1: "5085 Samet Dr",
  city: "High Point",
  state: "nc",
  zip: "27265",
  county: "Guilford",
  lat: "36.026793",
  lng: "-79.964927",
  geofenceRadiusM: "150",
  siteAccessText: "",
  lockboxInfo: "",
}

test("rates format and parse", () => {
  assert.equal(formatRate(675), "6.75%")
  assert.equal(formatRate(700), "7.0%")
  assert.equal(formatRate(750), "7.5%")
  assert.equal(parseRatePercent("7.25"), 725)
  assert.equal(parseRatePercent("7%"), 700)
  assert.equal(parseRatePercent("abc"), null)
  assert.equal(parseRatePercent("25"), null)
})

test("a good property passes and is cleaned", () => {
  const r = validateProperty(base)
  assert.ok(r.ok)
  if (r.ok) {
    assert.equal(r.value.state, "NC")
    assert.equal(r.value.lat, 36.026793)
    assert.equal(r.value.site_access_text, null)
  }
})

test("no pin is allowed; a pin outside NC is not", () => {
  assert.ok(validateProperty({ ...base, lat: "", lng: "" }).ok)
  assert.equal(validateProperty({ ...base, lat: "40.7", lng: "-74.0" }).ok, false)
  assert.equal(validateProperty({ ...base, lat: "36.0", lng: "" }).ok, false)
})

test("required fields and radius limits", () => {
  assert.equal(validateProperty({ ...base, name: " " }).ok, false)
  assert.equal(validateProperty({ ...base, zip: "2726" }).ok, false)
  assert.equal(validateProperty({ ...base, customerId: "x" }).ok, false)
  assert.equal(validateProperty({ ...base, geofenceRadiusM: "20" }).ok, false)
})

test("list filters", () => {
  const p = { name: "Griffin Park", city: "Lumberton", addressLine1: "x", county: "Robeson", active: true, lat: null }
  assert.ok(matchesProperty(p, "needs-pin", ""))
  assert.ok(matchesProperty(p, "active", "lumber"))
  assert.equal(matchesProperty(p, "retired", ""), false)
  assert.equal(matchesProperty({ ...p, lat: 34.6 }, "needs-pin", ""), false)
})

import {
  centsToDollars,
  parseDollars,
  validateContact,
  validateCustomer,
  validateSupplier,
  validateTeamMember,
  type CustomerInput,
} from "./setup"

const uuid = "11111111-1111-4111-8111-111111111111"

test("supplier needs a name; phone and email are checked", () => {
  assert.ok(validateSupplier({ name: "Ferguson", branch: "", phone: "336-555-0100", email: "", notes: "" }).ok)
  assert.equal(validateSupplier({ name: " ", branch: "", phone: "", email: "", notes: "" }).ok, false)
  assert.equal(validateSupplier({ name: "X", branch: "", phone: "555-0100", email: "", notes: "" }).ok, false)
  assert.equal(validateSupplier({ name: "X", branch: "", phone: "", email: "nope", notes: "" }).ok, false)
})

test("contact dedupes property links and lowercases email", () => {
  const r = validateContact({ customerId: uuid, name: "Pat", title: "", phone: "", email: "Pat@Example.com", smsOk: true, propertyIds: [uuid, uuid] })
  assert.ok(r.ok)
  if (r.ok) {
    assert.deepEqual(r.value.propertyIds, [uuid])
    assert.equal(r.value.row.email, "pat@example.com")
  }
})

test("dollars parse to cents and back", () => {
  assert.deepEqual(parseDollars("$1,250"), { ok: true, value: 125000 })
  assert.deepEqual(parseDollars(""), { ok: true, value: null })
  assert.equal(parseDollars("12.345").ok, false)
  assert.equal(centsToDollars(25000), "250")
  assert.equal(centsToDollars(25050), "250.50")
})

const customer: CustomerInput = {
  name: "Wynnefield Properties",
  billingContactId: uuid,
  billingEmailOverride: "",
  paymentTermsDays: "30",
  siteAccessText: "",
  addonApprovalMode: "call_first",
  addonApprovalLimit: "",
  addonApprovalNotes: "",
  signoffRequirement: "none",
  signoffNotes: "",
  residentReportMode: "confirm_with_property",
  residentReportNotes: "",
  requiresEstimateOver: "",
}

test("customer rules", () => {
  assert.ok(validateCustomer(customer).ok)
  assert.equal(validateCustomer({ ...customer, addonApprovalMode: "do_under_limit" }).ok, false)
  const r = validateCustomer({ ...customer, addonApprovalMode: "do_under_limit", addonApprovalLimit: "250" })
  assert.ok(r.ok && r.value.addon_approval_limit_cents === 25000)
  const r2 = validateCustomer({ ...customer, addonApprovalLimit: "250" })
  assert.ok(r2.ok && r2.value.addon_approval_limit_cents === null)
  assert.equal(validateCustomer({ ...customer, paymentTermsDays: "500" }).ok, false)
})

test("team member", () => {
  assert.ok(validateTeamMember({ fullName: "Mike", phone: "", truckLabel: "", role: "tech", active: true }).ok)
  assert.equal(validateTeamMember({ fullName: "Mike", phone: "", truckLabel: "", role: "boss", active: true }).ok, false)
})
