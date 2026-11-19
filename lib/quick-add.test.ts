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

import { defaultContactFor } from "./quick-add"

test("Quick Add picks the property's contact for you", () => {
  const contacts = [
    { id: "c1", name: "Pat", customerId: "w", customerName: "W", phone: null },
    { id: "c2", name: "Dana", customerId: "w", customerName: "W", phone: null },
    { id: "c3", name: "Lee", customerId: "x", customerName: "X", phone: null },
  ]
  const properties = [
    { id: "p1", name: "A", customerId: "w", customerName: "W", address: "", residentMode: null, residentNotes: null },
    { id: "p2", name: "B", customerId: "w", customerName: "W", address: "", residentMode: null, residentNotes: null },
    { id: "p3", name: "C", customerId: "x", customerName: "X", address: "", residentMode: null, residentNotes: null },
  ]
  const links = [
    { contactId: "c1", propertyId: "p1" },
    { contactId: "c2", propertyId: "p1", isPrimary: true },
  ]
  assert.equal(defaultContactFor("p1", contacts, links, properties)?.id, "c2")
  assert.equal(defaultContactFor("p2", contacts, links, properties)?.id, "c1")
  assert.equal(defaultContactFor("p3", contacts, links, properties)?.id, "c3")
})
