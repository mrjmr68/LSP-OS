import assert from "node:assert/strict"
import { test } from "node:test"

import { appMode, outboundAllowed } from "./app-mode"

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv

test("only Vercel production is live", () => {
  assert.equal(appMode(env({ VERCEL_ENV: "production" })), "live")
  assert.equal(appMode(env({ VERCEL_ENV: "preview" })), "test")
  assert.equal(appMode(env({ VERCEL_ENV: "development" })), "test")
  assert.equal(appMode(env({})), "test")
})

test("LSP_TEST_MODE=1 forces test mode on production", () => {
  assert.equal(appMode(env({ VERCEL_ENV: "production", LSP_TEST_MODE: "1" })), "test")
})

test("nothing goes out in test mode", () => {
  assert.equal(outboundAllowed("sms", env({ VERCEL_ENV: "preview" })), false)
  assert.equal(outboundAllowed("email", env({})), false)
  assert.equal(outboundAllowed("email", env({ VERCEL_ENV: "production" })), true)
})
