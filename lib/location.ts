// One location reader for the whole app (Board, My jobs, visit screens).
//
// Phones show the "allow location?" prompt every time a page asks for a
// position until permission is granted. So:
//  - we read the position on our own only when permission is already granted;
//  - otherwise nothing asks until the person taps "Turn on location" (or
//    "I'm here"), and that one tap starts a single shared watch;
//  - there is never more than one watch per app open.

export type Fix = { lat: number; lng: number; accuracyM: number | null; at: number }
export type LocationState = "granted" | "prompt" | "denied" | "unsupported"

let watchId: number | null = null
let last: Fix | null = null
let denied = false
const fixListeners = new Set<(fix: Fix) => void>()
const stateListeners = new Set<(state: LocationState) => void>()

const OK_KEY = "lsp:location-ok"

function supported(): boolean {
  return typeof navigator !== "undefined" && "geolocation" in navigator
}

function rememberOk() {
  try {
    window.sessionStorage.setItem(OK_KEY, "1")
  } catch {
    // Private mode: fine.
  }
}

function okThisSession(): boolean {
  try {
    return window.sessionStorage.getItem(OK_KEY) === "1"
  } catch {
    return false
  }
}

function notifyState(state: LocationState) {
  for (const fn of stateListeners) fn(state)
}

/** What the phone says about location for this site, without asking. */
export async function locationState(): Promise<LocationState> {
  if (!supported()) return "unsupported"
  if (denied) return "denied"
  if (watchId !== null || okThisSession()) return "granted"
  try {
    const status = await navigator.permissions?.query({ name: "geolocation" as PermissionName })
    if (status) {
      status.onchange = () => notifyState(status.state as LocationState)
      return status.state as LocationState
    }
  } catch {
    // Older phones have no permissions API: treat as not yet allowed.
  }
  return "prompt"
}

/** Start the one shared watch. Call only when granted, or from a tap. */
export function startLocation(): void {
  if (!supported() || watchId !== null || denied) return
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      last = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracyM: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
        at: Date.now(),
      }
      rememberOk()
      notifyState("granted")
      for (const fn of fixListeners) fn(last)
    },
    (err) => {
      if (err.code === err.PERMISSION_DENIED) {
        denied = true
        if (watchId !== null) navigator.geolocation.clearWatch(watchId)
        watchId = null
        notifyState("denied")
      }
    },
    { enableHighAccuracy: true, maximumAge: 30_000, timeout: 30_000 },
  )
}

export function lastFix(maxAgeMs: number): Fix | null {
  return last && Date.now() - last.at <= maxAgeMs ? last : null
}

export function onFix(fn: (fix: Fix) => void): () => void {
  fixListeners.add(fn)
  return () => fixListeners.delete(fn)
}

export function onLocationState(fn: (state: LocationState) => void): () => void {
  stateListeners.add(fn)
  return () => stateListeners.delete(fn)
}

/** A fresh position for a tap ("I'm here"). Starts the watch if needed; may ask once. */
export function fixNow(timeoutMs = 8000): Promise<Fix | null> {
  const fresh = lastFix(60_000)
  if (fresh) return Promise.resolve(fresh)
  if (!supported() || denied) return Promise.resolve(null)
  startLocation()
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      off()
      resolve(null)
    }, timeoutMs)
    const off = onFix((fix) => {
      window.clearTimeout(timer)
      off()
      resolve(fix)
    })
  })
}
