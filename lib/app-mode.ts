/**
 * Live vs test. Only the Vercel production deployment is live. Preview
 * links and local copies are test: they read and write the same database,
 * but nothing leaves the building (no email, no texts).
 *
 * LSP_TEST_MODE=1 forces test mode even on production (e.g. during a demo).
 */
export type AppMode = "live" | "test"

export function appMode(env: NodeJS.ProcessEnv = process.env): AppMode {
  if (env.LSP_TEST_MODE?.trim() === "1") {
    return "test"
  }
  return env.VERCEL_ENV === "production" ? "live" : "test"
}

export function isTestMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return appMode(env) === "test"
}

/** The one gate every outgoing email or text goes through. */
export function outboundAllowed(
  kind: "email" | "sms",
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isTestMode(env)) {
    console.info(`Test mode: ${kind} not sent.`)
    return false
  }
  return true
}
