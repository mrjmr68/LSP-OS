import assert from "node:assert/strict"
import test from "node:test"

import {
  feedbackContextSummary,
  feedbackDraftError,
  feedbackNoticeRecipients,
  feedbackNoticeText,
  storedFeedbackContext,
} from "./feedback"

test("feedback context keeps the board path, filter, and open call", () => {
  const input = {
    path: "/board",
    filter: "mine" as const,
    requestId: "77777777-7777-4777-8777-777777777777",
    displayNumber: "LSP-12",
  }
  assert.equal(feedbackContextSummary(input), "/board · My jobs · LSP-12")
  assert.deepEqual(storedFeedbackContext(input, "Mozilla/5.0 Phone"), {
    path: "/board",
    filter: "mine",
    request_id: "77777777-7777-4777-8777-777777777777",
    display_number: "LSP-12",
    user_agent: "Mozilla/5.0 Phone",
  })
})

test("feedback context drops a pending card and a bad path", () => {
  const stored = storedFeedbackContext(
    {
      path: "https://example.test/board",
      filter: "all",
      requestId: "pending-local",
      displayNumber: "Pending",
    },
    "  ",
  )
  assert.deepEqual(stored, {
    path: "/board",
    filter: "all",
    request_id: null,
    display_number: null,
    user_agent: null,
  })
  assert.equal(
    feedbackContextSummary({
      path: "/board",
      filter: "all",
      requestId: null,
      displayNumber: null,
    }),
    "/board · All jobs",
  )
})

test("feedback requires a type and one line, and the notice always includes Matt", () => {
  assert.equal(feedbackDraftError(null, "The card stayed open."), "Pick a type.")
  assert.equal(feedbackDraftError("bug", "   "), "Write at least one line.")
  assert.equal(feedbackDraftError("observation", "Unit 12B looked fine."), null)

  assert.deepEqual(feedbackNoticeRecipients(["Matt@Legsvc.com", "pat@lsp.test", ""]), [
    "matt@legsvc.com",
    "pat@lsp.test",
  ])

  const notice = feedbackNoticeText({
    kind: "suggestion",
    body: " Make the assign buttons taller. ",
    submitterName: "Alex Tech",
    summary: "/board · All jobs",
    userAgent: null,
  })
  assert.equal(notice.subject, "LSP note: Request / suggestion")
  assert.match(notice.text, /Alex Tech sent a request \/ suggestion/)
  assert.match(notice.text, /Make the assign buttons taller/)
  assert.match(notice.text, /Board: \/board · All jobs/)
})
