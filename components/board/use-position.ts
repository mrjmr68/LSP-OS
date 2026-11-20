"use client"

import { useCallback, useEffect, useState } from "react"

import { reportPosition } from "@/app/actions/board"
import {
  lastFix,
  locationState,
  onFix,
  onLocationState,
  startLocation,
  type LocationState,
} from "@/lib/location"

const EVERY_MS = 3 * 60 * 1000
const KEY = "lsp:last-position-report"

function due(): boolean {
  try {
    return Date.now() - Number(window.localStorage.getItem(KEY) ?? "0") > EVERY_MS
  } catch {
    return true
  }
}

/**
 * While the app is open, report this phone's position every few minutes.
 * Powers the crew strip and "closest first". Location tracking during the
 * working day was approved (Nov 18).
 *
 * It never asks for location by itself: it reads only when the phone has
 * already allowed it. Otherwise it returns state "prompt" and the screen
 * shows a "Turn on location" button that calls turnOn() from a tap.
 */
export function usePositionReporter(enabled: boolean): {
  state: LocationState | "checking"
  turnOn: () => void
} {
  const [state, setState] = useState<LocationState | "checking">("checking")

  useEffect(() => {
    if (!enabled) return
    let stopped = false
    void locationState().then((s) => {
      if (stopped) return
      setState(s)
      if (s === "granted") startLocation()
    })
    const offState = onLocationState((s) => {
      setState(s)
      if (s === "granted") startLocation()
    })

    function send() {
      if (stopped || document.visibilityState !== "visible" || !due()) return
      const fix = lastFix(5 * 60 * 1000)
      if (!fix) return
      try {
        window.localStorage.setItem(KEY, String(Date.now()))
      } catch {
        // Private mode: report anyway, just more often.
      }
      void reportPosition({ lat: fix.lat, lng: fix.lng, accuracyM: fix.accuracyM })
    }

    const offFix = onFix(send)
    const timer = window.setInterval(send, EVERY_MS)
    document.addEventListener("visibilitychange", send)
    return () => {
      stopped = true
      offState()
      offFix()
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", send)
    }
  }, [enabled])

  const turnOn = useCallback(() => startLocation(), [])
  return { state: enabled ? state : "unsupported", turnOn }
}
