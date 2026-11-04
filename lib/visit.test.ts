import assert from "node:assert/strict"
import test from "node:test"

import {
  attemptGaps,
  closeGaps,
  departureBlocked,
  formatDollars,
  pathAfterBundle,
  reduceQueue,
  syncLabel,
  withinGeofence,
  type VisitCommand,
} from "./visit"

const base = {
  path: "easy" as const,
  note: "Replaced the capacitor.",
  model: "",
  serial: "",
  bundleId: "bundle-1",
  requiresModelSerial: false,
  oneShot: false,
  signoff: "note_only" as const,
  signoffName: "",
  hasSignature: false,
  photoCount: 0,
  partDescription: "",
}

test("easy close needs a repair and a note", () => {
  assert.deepEqual(closeGaps({ ...base, bundleId: null, note: "  " }), [
    "Write a note.",
    "Pick a repair.",
  ])
  assert.deepEqual(closeGaps(base), [])
})

test("parts close needs typed model and serial, not a photo", () => {
  const gaps = closeGaps({
    ...base,
    path: "parts",
    model: "",
    serial: "123",
    partDescription: "45/5 capacitor",
    photoCount: 2,
  })
  assert.ok(gaps.some((gap) => gap.includes("nameplate photo is not enough")))
  assert.deepEqual(
    closeGaps({
      ...base,
      path: "parts",
      model: "GSX140241",
      serial: "1234567890",
      partDescription: "45/5 capacitor",
    }),
    [],
  )
})

test("photos are required only when the property says so", () => {
  assert.deepEqual(closeGaps({ ...base, signoff: "none", photoCount: 0 }), [])
  assert.deepEqual(closeGaps({ ...base, signoff: "photos", photoCount: 0 }), [
    "This property needs a photo.",
  ])
  assert.deepEqual(closeGaps({ ...base, signoff: "photos", photoCount: 1 }), [])
})

test("walkthrough sign-off needs a name and a signature", () => {
  assert.deepEqual(
    closeGaps({ ...base, signoff: "walkthrough_signature", signoffName: "", hasSignature: false }),
    ["Sign-off needs a name.", "Sign-off needs a signature."],
  )
  assert.deepEqual(
    closeGaps({
      ...base,
      signoff: "walkthrough_signature",
      signoffName: "Pat",
      hasSignature: true,
    }),
    [],
  )
})

test("attempt needs a reason and a note, and parts blocks leaving", () => {
  assert.deepEqual(attemptGaps(null, " "), [
    "Pick why you could not get in.",
    "Write what happened.",
  ])
  assert.deepEqual(attemptGaps("lockbox", "Lockbox was empty."), [])
  assert.equal(departureBlocked("parts", "", "123"), true)
  assert.equal(departureBlocked("parts", "GSX", "123"), false)
  assert.equal(departureBlocked("easy", "", ""), false)
})

test("a one-shot repair arms the parts path", () => {
  assert.equal(pathAfterBundle("easy", true), "parts")
  assert.equal(pathAfterBundle("estimate", false), "estimate")
  assert.ok(closeGaps({ ...base, oneShot: true }).some((gap) => gap.includes("Needs parts")))
})

test("geofence is 150 meters, not a mile", () => {
  assert.equal(withinGeofence(37.54, -77.436, 37.5401, -77.436, 150), true)
  assert.equal(withinGeofence(37.54, -77.436, 37.55, -77.436, 150), false)
  assert.equal(formatDollars(10000), "$100.00")
})

test("sync label follows draft, queue, and conflict", () => {
  assert.deepEqual(syncLabel({ offline: false, queued: 0, conflict: false }), {
    tone: "synced",
    label: "Synced",
  })
  assert.equal(syncLabel({ offline: true, queued: 2, conflict: false }).tone, "offline")
  assert.equal(syncLabel({ offline: false, queued: 1, conflict: false }).label, "1 pending")
  assert.equal(syncLabel({ offline: true, queued: 1, conflict: true }).tone, "conflict")
})

test("queue flush drops a conflicting call and retries the rest later", () => {
  const items: VisitCommand[] = [
    { id: "1", requestId: "a", seenAt: null, kind: "start_job" },
    { id: "2", requestId: "a", seenAt: null, kind: "on_site", source: "tap", lat: null, lng: null },
    { id: "3", requestId: "b", seenAt: null, kind: "start_job" },
  ]
  const conflict = reduceQueue(items, "conflict")
  assert.deepEqual(
    conflict.items.map((item) => item.id),
    ["3"],
  )
  assert.equal(conflict.stop, false)
  const retry = reduceQueue(conflict.items, "retry")
  assert.equal(retry.stop, true)
  assert.equal(retry.items[0]?.id, "3")
  const done = reduceQueue(retry.items, "ok")
  assert.deepEqual(done.items, [])
})
