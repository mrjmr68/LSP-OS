import assert from "node:assert/strict"
import test from "node:test"

import { equipmentLabel, parseNameplateReply } from "./nameplate"

test("reads a clean reply", () => {
  const f = parseNameplateReply(
    '{"side":"outdoor","brand":"Goodman","model":"GSX14 0361","serial":"1712345678","tons":3,"refrigerant":"R-410A","confidence":"high"}',
  )
  assert.deepEqual(f, {
    side: "outdoor",
    brand: "Goodman",
    model: "GSX140361",
    serial: "1712345678",
    tons: 3,
    refrigerant: "R-410A",
    confidence: "high",
  })
})

test("finds the JSON inside extra words and marks missing numbers low", () => {
  const f = parseNameplateReply('Here you go: {"side":"indoor","model":"ARUF37C14","serial":null,"confidence":"high"} done')
  assert.equal(f?.side, "indoor")
  assert.equal(f?.model, "ARUF37C14")
  assert.equal(f?.serial, null)
  assert.equal(f?.confidence, "low")
})

test("junk is null or cleaned", () => {
  assert.equal(parseNameplateReply("no plate here"), null)
  assert.equal(parseNameplateReply("{not json}"), null)
  const f = parseNameplateReply('{"side":"roof","model":"x","serial":"ABC123","tons":400}')
  assert.equal(f?.side, "unknown")
  assert.equal(f?.model, null)
  assert.equal(f?.tons, null)
})

test("equipment label", () => {
  assert.equal(equipmentLabel({ model: "GSX140361", serial: "1712345678" }), "GSX140361 · 1712345678")
  assert.equal(equipmentLabel({ model: "GSX140361", serial: null }), "GSX140361")
})

test("brand and refrigerant from plate text", async () => {
  const { matchBrand, matchRefrigerant } = await import("./nameplate")
  assert.equal(matchBrand("GOODMAN MANUFACTURING CO"), "Goodman")
  assert.equal(matchBrand("International Comfort Products"), "ICP")
  assert.equal(matchBrand("Tempstar"), "Tempstar")
  assert.equal(matchBrand("Acme Air"), "Acme Air")
  assert.equal(matchBrand(null), null)
  assert.equal(matchRefrigerant("R410A"), "R-410A")
  assert.equal(matchRefrigerant("HFC-410A"), "R-410A")
  assert.equal(matchRefrigerant("r-454b"), "R-454B")
  assert.equal(matchRefrigerant("R-12"), "R-12")
})
