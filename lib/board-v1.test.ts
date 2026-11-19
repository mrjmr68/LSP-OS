import assert from "node:assert/strict"
import { test } from "node:test"

import type { BoardCard } from "./board"
import {
  assignChoices,
  crewChipLabel,
  crewStates,
  displayStageOf,
  groupByDisplayStage,
  milesBetween,
  minutesSince,
  moveId,
  myJobs,
  queueLabel,
} from "./board-v1"

let n = 0
function card(over: Partial<BoardCard>): BoardCard {
  n += 1
  return {
    id: `c${n}`,
    displayNumber: `R-${n}`,
    issue: "No cooling",
    status: "new",
    priority: "normal",
    assignedUserId: null,
    assigneeName: null,
    propertyName: "Britton Village",
    unitId: `u${n}`,
    unitLabel: `${n}A`,
    address: "",
    contactName: "",
    contactPhone: null,
    sourceLabel: "Portal",
    ageLabel: "1h",
    bumpedAtMs: null,
    createdAtMs: 1_000 + n,
    repeatCalls: [],
    pendingSync: false,
    myJobsPosition: null,
    propertyLat: 36.07,
    propertyLng: -79.79,
    fieldState: null,
    ...over,
  }
}

test("seven stages over ten statuses; closed drops off", () => {
  assert.equal(displayStageOf("assigned"), "new")
  assert.equal(displayStageOf("estimate_out"), "estimate")
  assert.equal(displayStageOf("closed"), null)
  const groups = groupByDisplayStage([card({ status: "new" }), card({ status: "assigned" }), card({ status: "closed" })])
  assert.equal(groups.length, 7)
  assert.equal(groups[0]?.cards.length, 2)
  assert.equal(groups.reduce((t, g) => t + g.cards.length, 0), 2)
})

test("distance and minutes", () => {
  const gso = { lat: 36.0726, lng: -79.792 }
  const hp = { lat: 35.9557, lng: -80.0053 }
  const miles = milesBetween(gso, hp)
  assert.ok(miles > 13 && miles < 16, String(miles))
  assert.equal(minutesSince(0, 32 * 60_000), "32 min")
  assert.equal(minutesSince(0, 70 * 60_000), "1 h 10 min")
})

const crew = [
  { id: "sam", fullName: "sam smith", role: "tech" as const, lastLat: 35.96, lastLng: -80.0 },
  { id: "alex", fullName: "Alex", role: "tech" as const, lastLat: 36.07, lastLng: -79.8 },
  { id: "chris", fullName: "Chris", role: "tech" as const },
  { id: "dana", fullName: "Dana", role: "tech" as const, lastLat: 36.1, lastLng: -79.7 },
]

test("crew states: free, on site at the job, driving", () => {
  const cards = [
    card({ assignedUserId: "sam", status: "in_progress", propertyLat: 36.0, propertyLng: -79.9, fieldState: { kind: "on_site", sinceMs: 0 } }),
    card({ assignedUserId: "dana", status: "in_progress", fieldState: { kind: "driving", sinceMs: 0 } }),
  ]
  const states = crewStates(crew, cards)
  const sam = states.find((s) => s.id === "sam")
  assert.equal(sam?.state, "on_site")
  assert.equal(sam?.name, "Sam")
  assert.deepEqual(sam?.position, { lat: 36.0, lng: -79.9 })
  assert.equal(states.find((s) => s.id === "dana")?.state, "driving")
  assert.equal(states.find((s) => s.id === "alex")?.state, "free")
  assert.equal(crewChipLabel(states.find((s) => s.id === "alex")!, false), "Alex · free")
})

test("assign picker: free closest first, unknown last; busy separate", () => {
  const cards = [card({ assignedUserId: "dana", status: "in_progress", fieldState: { kind: "driving", sinceMs: 0 } })]
  const states = crewStates(crew, cards)
  const target = { propertyLat: 36.0726, propertyLng: -79.792 }
  const { free, busy } = assignChoices(target, states)
  assert.deepEqual(free.map((f) => f.id), ["alex", "sam", "chris"])
  assert.equal(free[2]?.miles, null)
  assert.deepEqual(busy.map((b) => b.id), ["dana"])
})

test("my jobs: the live job first, then their order, then the Board order", () => {
  const a = card({ assignedUserId: "sam", status: "ready", myJobsPosition: 2 })
  const b = card({ assignedUserId: "sam", status: "assigned", myJobsPosition: 1 })
  const c = card({ assignedUserId: "sam", status: "in_progress" })
  const d = card({ assignedUserId: "sam", status: "assigned" })
  const e = card({ assignedUserId: "sam", status: "parts" })
  const other = card({ assignedUserId: "alex", status: "assigned" })
  const list = myJobs([a, b, c, d, e, other], "sam")
  assert.deepEqual(list.map((x) => x.id), [c.id, b.id, a.id, d.id])
  const all = [a, b, c, d, e, other]
  assert.equal(queueLabel({ ...b, assigneeName: "sam smith" }, all), "Sam · next")
  assert.equal(queueLabel({ ...a, assigneeName: "sam smith" }, all), "Sam · 2nd")
  assert.equal(queueLabel({ ...d, assigneeName: "sam smith" }, all), "Sam · 3rd")
})

test("moveId reorders", () => {
  assert.deepEqual(moveId(["a", "b", "c"], 2, 0), ["c", "a", "b"])
  assert.deepEqual(moveId(["a", "b", "c"], 0, 5), ["b", "c", "a"])
})

import { repeatBadge } from "./board-v1"

test("repeat badge", () => {
  const day = 86_400_000
  const call = { id: "x", displayNumber: "R-1", issue: "", status: "closed" as const, whenLabel: "", bundleCodes: [] }
  assert.equal(repeatBadge({ repeatCalls: [] }, 10 * day), null)
  assert.equal(repeatBadge({ repeatCalls: [{ ...call, createdAtMs: day }] }, 10 * day), "Here 9 days ago")
  assert.equal(repeatBadge({ repeatCalls: [{ ...call, createdAtMs: 9 * day }] }, 10 * day), "Here yesterday")
})
