"use client"

import "leaflet/dist/leaflet.css"

import type * as Leaflet from "leaflet"
import { useEffect, useRef, useState } from "react"

/** Greensboro, for a property with no pin and no search yet. */
const HOME: [number, number] = [36.0726, -79.792]

/**
 * Map with one draggable pin and the arrival circle. Tap the map or drag
 * the pin to move it. OpenStreetMap tiles; no API key.
 */
export function PinMap({
  lat,
  lng,
  radiusM,
  focus,
  onMove,
}: {
  lat: number | null
  lng: number | null
  radiusM: number
  /** Changes whenever the map should fly to the pin (e.g. after Find). */
  focus: number
  onMove: (lat: number, lng: number) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<Leaflet.Map | null>(null)
  const pin = useRef<Leaflet.Marker | null>(null)
  const ring = useRef<Leaflet.Circle | null>(null)
  const L = useRef<typeof Leaflet | null>(null)
  const onMoveRef = useRef(onMove)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    onMoveRef.current = onMove
  }, [onMove])

  // Create the map once.
  useEffect(() => {
    let cancelled = false
    void import("leaflet").then((leaflet) => {
      if (cancelled || !box.current || map.current) return
      L.current = leaflet
      const start: [number, number] = lat !== null && lng !== null ? [lat, lng] : HOME
      const m = leaflet.map(box.current, { zoomControl: true }).setView(start, lat !== null ? 17 : 11)
      leaflet
        .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "© OpenStreetMap contributors",
        })
        .addTo(m)
      m.on("click", (e: Leaflet.LeafletMouseEvent) => {
        onMoveRef.current(e.latlng.lat, e.latlng.lng)
      })
      map.current = m
      setReady(true)
    })
    return () => {
      cancelled = true
      map.current?.remove()
      map.current = null
      pin.current = null
      ring.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- create once; later moves are handled below
  }, [])

  // Keep the pin and circle in step with the form.
  useEffect(() => {
    const leaflet = L.current
    const m = map.current
    if (!leaflet || !m) return
    if (lat === null || lng === null) {
      pin.current?.remove()
      ring.current?.remove()
      pin.current = null
      ring.current = null
      return
    }
    if (!pin.current) {
      const icon = leaflet.divIcon({
        className: "",
        html: '<div style="width:22px;height:22px;border-radius:9999px;background:var(--primary);border:3px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      })
      pin.current = leaflet.marker([lat, lng], { draggable: true, icon }).addTo(m)
      pin.current.on("dragend", () => {
        const p = pin.current?.getLatLng()
        if (p) onMoveRef.current(p.lat, p.lng)
      })
      ring.current = leaflet
        .circle([lat, lng], { radius: radiusM, color: "#1c3330", weight: 1, fillOpacity: 0.08 })
        .addTo(m)
    } else {
      pin.current.setLatLng([lat, lng])
      ring.current?.setLatLng([lat, lng])
    }
    ring.current?.setRadius(radiusM)
  }, [ready, lat, lng, radiusM])

  // Fly to the pin when asked.
  useEffect(() => {
    if (focus === 0 || lat === null || lng === null) return
    map.current?.setView([lat, lng], 17)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on a new focus request
  }, [focus])

  return (
    <div
      ref={box}
      role="application"
      aria-label="Map. Tap to place the pin, or drag it."
      className="h-72 w-full overflow-hidden rounded-xl border border-border lg:h-[420px]"
    />
  )
}
