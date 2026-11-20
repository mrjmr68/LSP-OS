import assert from "node:assert/strict"
import test from "node:test"

import {
  invoiceEmail,
  invoiceTotals,
  lineAmount,
  longDate,
  minutesLabel,
  minutesShort,
  money,
  moneyExact,
  multiRepairNote,
  parseDollars,
  ratePercent,
  reviewTag,
  shortDate,
} from "./review"

test("money drops cents when whole and marks negatives", () => {
  assert.equal(money(40000), "$400")
  assert.equal(money(40050), "$400.50")
  assert.equal(money(-2500), "−$25")
  assert.equal(moneyExact(123450), "$1,234.50")
})

test("parseDollars reads what an owner types", () => {
  assert.equal(parseDollars("45"), 4500)
  assert.equal(parseDollars("$1,200.5"), 120050)
  assert.equal(parseDollars("-20"), -2000)
  assert.equal(parseDollars("−20"), -2000)
  assert.equal(parseDollars(".5"), 50)
  assert.equal(parseDollars("abc"), null)
  assert.equal(parseDollars(""), null)
  assert.equal(parseDollars("1.234"), null)
})

test("totals match the database rounding", () => {
  assert.deepEqual(invoiceTotals([{ amountCents: 26500 }, { amountCents: 19500 }], 700), {
    subtotal: 46000,
    tax: 3220,
    total: 49220,
  })
  // 6.75% of $1.00 is 6.75 cents → 7
  assert.equal(invoiceTotals([{ amountCents: 100 }], 675).tax, 7)
  assert.equal(invoiceTotals([{ amountCents: -100 }], 675).tax, 0)
})

test("a repair is the sum of the cost lines still in", () => {
  assert.equal(
    lineAmount([
      { amountCents: 9000, removed: false },
      { amountCents: 500, removed: true },
      { amountCents: 10000, removed: false },
    ]),
    19000,
  )
})

test("list tags: questions first, then several repairs", () => {
  assert.deepEqual(reviewTag({ repairCount: 2, question: null, answered: false, techName: "Sam Tech" }), {
    text: "2 repairs · set the price",
    tone: "amber",
  })
  assert.equal(reviewTag({ repairCount: 2, question: "Same unit?", answered: false, techName: "Sam Tech" })?.text, "Asked Sam")
  assert.equal(reviewTag({ repairCount: 1, question: "x", answered: true, techName: "Sam" })?.text, "Sam answered")
  assert.equal(reviewTag({ repairCount: 1, question: null, answered: false, techName: null }), null)
  assert.equal(multiRepairNote(1), null)
  assert.match(multiRepairNote(2) ?? "", /^2 repairs/)
})

test("labels", () => {
  assert.equal(ratePercent(675), "6.75%")
  assert.equal(ratePercent(700), "7%")
  assert.equal(minutesLabel(41), "41 min")
  assert.equal(minutesLabel(65), "1 hr 5 min")
  assert.equal(minutesLabel(120), "2 hr")
  assert.equal(minutesShort(41), "41m")
  assert.equal(minutesShort(65), "1h 5m")
  assert.equal(minutesShort(120), "2h")
  assert.equal(shortDate("2026-11-17"), "Nov 17")
  assert.equal(longDate("2026-11-17T10:00:00Z"), "November 17, 2026")
})

test("invoice email names the number, place, amount and due date", () => {
  const mail = invoiceEmail({
    number: "1001",
    propertyName: "Juniper Village",
    unitLabel: "12B",
    totalCents: 49220,
    dueLabel: "December 17, 2026",
    companyName: "Legend Service Pros",
  })
  assert.equal(mail.subject, "Invoice 1001 · Juniper Village 12B")
  assert.match(mail.text, /\$492\.20, due December 17, 2026/)
})
