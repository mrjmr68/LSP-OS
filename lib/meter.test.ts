import assert from "node:assert/strict"
import test from "node:test"

import { parseMeterReply } from "./meter"

test("reads a manifold reply", () => {
  const r = parseMeterReply('{"suction":118.4,"liquid":342,"suctionLine":52.1,"liquidLine":88,"returnAir":null,"supplyAir":null,"confidence":"high"}')
  assert.deepEqual(r?.values, { suction: "118.4", liquid: "342", suctionLine: "52.1", liquidLine: "88" })
  assert.equal(r?.count, 4)
  assert.equal(r?.confidence, "high")
})

test("drops values out of range and non-numbers", () => {
  const r = parseMeterReply('{"suction":"118","liquid":9999,"returnAir":75,"supplyAir":56}')
  assert.deepEqual(r?.values, { returnAir: "75", supplyAir: "56" })
  assert.equal(r?.confidence, "low")
})

test("not JSON", () => {
  assert.equal(parseMeterReply("I can't read this"), null)
})
