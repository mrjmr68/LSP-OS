import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

import {
  CONTACT_CUSTOMER_EMBED,
  QUICK_ADD_DEFAULT_REPORTED_BY_RESIDENT,
  QUICK_ADD_DEFAULT_SOURCE,
} from "./quick-add"

test("contact embed names the customer_id relationship", () => {
  assert.equal(
    CONTACT_CUSTOMER_EMBED,
    "customers!customer_contacts_customer_id_fkey(name)",
  )
  assert.equal(CONTACT_CUSTOMER_EMBED.includes("billing_contact"), false)
})

test("quick add defaults source to phone and resident reported off", () => {
  assert.equal(QUICK_ADD_DEFAULT_SOURCE, "phone")
  assert.equal(QUICK_ADD_DEFAULT_REPORTED_BY_RESIDENT, false)
})

test("quick add sheet keeps the four fields and drops source and resident reported", () => {
  const source = fs.readFileSync(
    new URL("../components/board/quick-add.tsx", import.meta.url),
    "utf8",
  )
  for (const label of ["Contact", "Property", "Unit", "Issue", "Save call"]) {
    assert.equal(source.includes(label), true, label)
  }
  assert.equal(source.includes("Resident reported"), false)
  assert.equal(source.includes("QUICK_ADD_SOURCES"), false)
  assert.equal(source.includes(">Source<"), false)
  assert.match(source, /QUICK_ADD_DEFAULT_SOURCE/)
  assert.match(source, /QUICK_ADD_DEFAULT_REPORTED_BY_RESIDENT/)
})

test("create path forces the quick add defaults", () => {
  const source = fs.readFileSync(new URL("../app/actions/board.ts", import.meta.url), "utf8")
  assert.match(source, /source:\s*QUICK_ADD_DEFAULT_SOURCE/)
  assert.match(source, /reported_by_resident:\s*QUICK_ADD_DEFAULT_REPORTED_BY_RESIDENT/)
  assert.equal(source.includes("input.source"), false)
  assert.equal(source.includes("input.reportedByResident"), false)
})
