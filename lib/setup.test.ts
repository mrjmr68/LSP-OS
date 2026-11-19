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
