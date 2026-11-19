"use client"

import { useEffect } from "react"

import { reportPosition } from "@/app/actions/board"

const EVERY_MS = 3 * 60 * 1000
const KEY = "lsp:last-position-report"

/**
 * While the app is open, report this phone's position every few minutes.
 * Powers the crew strip and "closest first". Location tracking during the
 * working day was approved (Nov 18). Nothing is sent while hidden.
 */
export function usePositionReporter(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !("geolocation" in navigator)) {
      return
    }
    let stopped = false

    function due(): boolean {
      try {
        const last = Number(window.localStorage.getItem(KEY) ?? "0")
        return Date.now() - last > EVERY_MS
      } catch {
        return true
      }
    }

    function report() {
      if (stopped || document.visibilityState !== "visible" || !due()) return
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (stopped) return
          try {
            window.localStorage.setItem(KEY, String(Date.now()))
          } catch {
            // Private mode: report anyway, just more often.
          }
          void reportPosition({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracyM: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
          })
        },
        () => {
          // Denied or unavailable: the Board falls back to job locations.
        },
        { enableHighAccuracy: false, maximumAge: 60_000, timeout: 15_000 },
      )
    }

    report()
    const timer = window.setInterval(report, EVERY_MS)
    document.addEventListener("visibilitychange", report)
    return () => {
      stopped = true
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", report)
    }
  }, [enabled])
}
