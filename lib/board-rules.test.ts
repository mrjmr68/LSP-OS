import assert from "node:assert/strict"
import test from "node:test"

import {
  compareBoardCards,
  categoriesForStageView,
  groupBoardByStage,
  parseBoardStageView,
  type BoardCard,
} from "./board"
import {
  crewStandpoint,
  duplicateWarningText,
  estimateDriveMinutes,
  haversineMiles,
  mapsDirectionsUrl,
  minutesFromDistanceMatrix,
  ownerStatusNeedsReason,
  pairNeedsLink,
  quickAddMissing,
  runGoEnRoute,
} from "./board-rules"

test("owner status switch asks for a reason only when a step is skipped", () => {
  assert.equal(ownerStatusNeedsReason("new", "assigned"), false)
  assert.equal(ownerStatusNeedsReason("new", "ready"), false)
  assert.equal(ownerStatusNeedsReason("assigned", "ready"), false)
  assert.equal(ownerStatusNeedsReason("parts", "ready"), false)
  assert.equal(ownerStatusNeedsReason("invoiced", "closed"), false)
  assert.equal(ownerStatusNeedsReason("new", "in_progress"), true)
  assert.equal(ownerStatusNeedsReason("new", "closed"), true)
  assert.equal(ownerStatusNeedsReason("complete", "invoiced"), true)
  assert.equal(ownerStatusNeedsReason("closed", "new"), true)
})

test("duplicate warning names the unit, the issue, and the age", () => {
  const now = Date.parse("2026-11-02T15:00:00.000Z")
  const text = duplicateWarningText({
    unitLabel: "12B",
    issue: "No heat",
    status: "complete",
    createdAt: "2026-10-30T15:00:00.000Z",
    nowMs: now,
  })
  assert.equal(text, "12B had No heat 3 days ago — Complete")
})

test("quick add blocks only the four required fields", () => {
  assert.deepEqual(
    quickAddMissing({
      contactId: "",
      propertyId: "p",
      unitId: null,
      unitText: "",
      issue: "  ",
    }),
    ["contact", "unit", "issue"],
  )
  assert.deepEqual(
    quickAddMissing({
      contactId: "c",
      propertyId: "p",
      unitId: null,
      unitText: "4A",
      issue: "No cool",
    }),
    [],
  )
})

test("an unlinked contact and property need a link", () => {
  const links = [{ contactId: "c1", propertyId: "p1" }]
  assert.equal(pairNeedsLink(links, "c1", "p1"), false)
  assert.equal(pairNeedsLink(links, "c1", "p2"), true)
  assert.equal(pairNeedsLink(links, "", "p2"), false)
})

test("maps url carries the address and the tech origin", () => {
  const url = mapsDirectionsUrl("100 Oak Court, Richmond, VA 23220", {
    lat: 37.5,
    lng: -77.4,
  })
  assert.match(url, /^https:\/\/www\.google\.com\/maps\/dir\//)
  assert.match(url, /destination=100\+Oak\+Court/)
  assert.match(url, /origin=37\.5%2C-77\.4/)
  const destinationOnly = mapsDirectionsUrl("100 Oak Court, Richmond, VA 23220", null)
  assert.equal(destinationOnly.includes("origin="), false)
})

const oak = "100 Oak Court, Richmond, VA 23220"

test("go en route asks for location before it opens maps", async () => {
  const events: string[] = []
  let release: (origin: { lat: number; lng: number }) => void = () => {}
  const pendingLocation = new Promise<{ lat: number; lng: number }>((resolve) => {
    release = resolve
  })
  const pending = runGoEnRoute({
    fallbackAddress: oak,
    locate: () => {
      events.push("location")
      return pendingLocation
    },
    save: async (origin) => {
      events.push(`save:${origin?.lat ?? "none"}`)
      return { ok: true, address: oak, notice: "ETA text queued." }
    },
    openMaps: (url) => {
      events.push("maps")
      assert.equal(url.includes("about:blank"), false)
      assert.match(url, /^https:\/\/www\.google\.com\/maps\/dir\//)
      assert.match(url, /origin=37\.5%2C-77\.4/)
      return true
    },
  })
  await Promise.resolve()
  assert.deepEqual(events, ["location"])
  release({ lat: 37.5, lng: -77.4 })
  const outcome = await pending
  assert.deepEqual(events, ["location", "save:37.5", "maps"])
  assert.equal(outcome.ok, true)
  if (!outcome.ok) {
    return
  }
  assert.equal(outcome.notice, "ETA text queued.")
  assert.equal(outcome.closeSheet, true)
  assert.equal(outcome.sheetNote, null)
})

test("denied location still goes en route and keeps maps on the call", async () => {
  let opened = false
  const outcome = await runGoEnRoute({
    fallbackAddress: oak,
    locate: async () => null,
    save: async (origin) => {
      assert.equal(origin, null)
      return { ok: true, address: `  ${oak}  `, notice: "On the way." }
    },
    openMaps: (url) => {
      opened = true
      assert.equal(url.includes("origin="), false)
      assert.equal(url.includes("about:blank"), false)
      return false
    },
  })
  assert.equal(opened, true)
  assert.equal(outcome.ok, true)
  if (!outcome.ok) {
    return
  }
  assert.equal(
    outcome.notice,
    "On the way. Location was off, so the text has no drive time.",
  )
  assert.equal(outcome.closeSheet, false)
  assert.equal(
    outcome.sheetNote,
    "On the way. Location was off, so the text has no drive time. Tap Open in Maps.",
  )
  assert.equal(outcome.address, oak)
})

test("a call that already started still opens maps from this page", async () => {
  const outcome = await runGoEnRoute({
    fallbackAddress: oak,
    locate: async () => ({ lat: 37.5, lng: -77.4 }),
    save: async () => ({ ok: false, message: "This call is not ready to start." }),
    openMaps: (url) => {
      assert.match(url, /origin=37\.5%2C-77\.4/)
      return false
    },
  })
  assert.equal(outcome.ok, true)
  if (!outcome.ok) {
    return
  }
  assert.equal(
    outcome.notice,
    "This call is already In Progress.",
  )
  assert.equal(
    outcome.sheetNote,
    "This call is already In Progress. Open it in Maps below.",
  )
  assert.equal(outcome.closeSheet, false)
})

test("a call that already started without location says maps has no start point", async () => {
  const outcome = await runGoEnRoute({
    fallbackAddress: oak,
    locate: async () => ({ lat: Number.NaN, lng: -77.4 }),
    save: async () => ({
      ok: false,
      message: "ERROR: 42501: This call is not ready to start.",
    }),
    openMaps: () => true,
  })
  assert.equal(outcome.ok, true)
  if (!outcome.ok) {
    return
  }
  assert.equal(outcome.closeSheet, true)
  assert.equal(
    outcome.notice,
    "This call is already In Progress. Location was off, so Maps has no start point.",
  )
  assert.equal(outcome.mapsUrl.includes("origin="), false)
})

test("another save error does not open maps", async () => {
  let opened = false
  const outcome = await runGoEnRoute({
    fallbackAddress: oak,
    locate: async () => ({ lat: 37.5, lng: -77.4 }),
    save: async () => ({ ok: false, message: "Sign in again to change the board." }),
    openMaps: () => {
      opened = true
      return true
    },
  })
  assert.equal(opened, false)
  assert.deepEqual(outcome, {
    ok: false,
    message: "Sign in again to change the board.",
  })
})

test("distance matrix minutes round up from seconds", () => {
  assert.equal(
    minutesFromDistanceMatrix({
      rows: [{ elements: [{ status: "OK", duration: { value: 90 } }] }],
    }),
    2,
  )
  assert.equal(minutesFromDistanceMatrix({ rows: [] }), null)
  assert.equal(estimateDriveMinutes(14), 30)
})

test("haversine is zero at one point and positive across town", () => {
  assert.equal(haversineMiles(37.5, -77.4, 37.5, -77.4), 0)
  assert.ok(haversineMiles(37.54, -77.43, 37.5, -77.4) > 1)
})

test("live stages are the seven open stages, in board order", () => {
  assert.deepEqual(
    categoriesForStageView("live").map((category) => category.status),
    ["new", "assigned", "ready", "in_progress", "to_estimate", "estimate_out", "parts"],
  )
  assert.equal(categoriesForStageView("all").length, 10)
  assert.equal(parseBoardStageView(null), "live")
  assert.equal(parseBoardStageView("all"), "all")
  assert.equal(parseBoardStageView("closed"), "live")
})

test("a new call stays under New, and Ready only holds ready calls", () => {
  const fresh = { id: "quick-add", status: "new" as const }
  const waiting = { id: "parts-in", status: "ready" as const }
  const done = { id: "billed", status: "complete" as const }
  const live = groupBoardByStage([waiting, fresh, done], "live")

  assert.deepEqual(
    live.map((group) => group.status),
    ["new", "assigned", "ready", "in_progress", "to_estimate", "estimate_out", "parts"],
  )
  assert.deepEqual(live[0]?.cards.map((card) => card.id), ["quick-add"])
  assert.equal(live[0]?.label, "New")
  assert.deepEqual(live[2]?.cards.map((card) => card.id), ["parts-in"])
  assert.equal(live[2]?.label, "Ready")
  assert.equal(
    live.some((group) => group.status !== "new" && group.cards.some((card) => card.id === "quick-add")),
    false,
  )
  assert.equal(live.some((group) => group.cards.some((card) => card.id === "billed")), false)

  const all = groupBoardByStage([fresh, done], "all")
  assert.equal(all[0]?.status, "new")
  assert.equal(all.at(-1)?.status, "closed")
  assert.deepEqual(all.find((group) => group.status === "complete")?.cards.map((card) => card.id), [
    "billed",
  ])
  assert.deepEqual(all.find((group) => group.status === "ready")?.cards, [])
})

test("who's where puts a busy person first, then free people A to Z", () => {
  const rows = crewStandpoint(
    [
      { id: "zoe", fullName: "Zoe", role: "tech" },
      { id: "amy", fullName: "Amy", role: "tech" },
      { id: "matt", fullName: "Matt", role: "owner" },
    ],
    [
      card({
        id: "done",
        priority: "normal",
        createdAtMs: 1,
        bumpedAtMs: null,
        assignedUserId: "zoe",
        status: "complete",
      }),
      card({
        id: "now",
        priority: "normal",
        createdAtMs: 2,
        bumpedAtMs: null,
        assignedUserId: "matt",
        status: "assigned",
      }),
      card({
        id: "site",
        priority: "normal",
        createdAtMs: 3,
        bumpedAtMs: null,
        assignedUserId: "matt",
        status: "in_progress",
      }),
    ],
  )
  assert.deepEqual(
    rows.map((row) => row.fullName),
    ["Matt", "Amy", "Zoe"],
  )
  assert.deepEqual(
    rows[0]?.jobs.map((job) => job.id),
    ["site", "now"],
  )
  assert.equal(rows[1]?.jobs.length, 0)
  assert.equal(rows[2]?.jobs.length, 0)
})

test("high calls sort above an older normal call", () => {
  const olderHigh = card({
    id: "a",
    priority: "high",
    createdAtMs: 1,
    bumpedAtMs: null,
  })
  const newerNormal = card({
    id: "b",
    priority: "normal",
    createdAtMs: 2,
    bumpedAtMs: 50,
  })
  assert.deepEqual(
    [newerNormal, olderHigh].sort(compareBoardCards).map((item) => item.id),
    ["a", "b"],
  )
})

function card(overrides: Partial<BoardCard> & Pick<BoardCard, "id" | "priority" | "createdAtMs" | "bumpedAtMs">): BoardCard {
  return {
    displayNumber: "LSP-1",
    issue: "No heat",
    status: "new",
    assignedUserId: null,
    assigneeName: null,
    propertyName: "Oak Court",
    unitId: "u",
    unitLabel: "12B",
    address: "100 Oak Court, Richmond, VA 23220",
    contactName: "Pat",
    contactPhone: "555-0140",
    sourceLabel: "Phone",
    ageLabel: "5m",
    repeatCalls: [],
    pendingSync: false,
    ...overrides,
  }
}
