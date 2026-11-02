import {
  estimateDriveMinutes,
  haversineMiles,
  minutesFromDistanceMatrix,
} from "@/lib/board-rules"

export type GeoPoint = { lat: number; lng: number }

/**
 * Google drive time when GOOGLE_MAPS_API_KEY is set.
 * Otherwise a straight-line estimate when the property has coordinates.
 * Null when neither is available — the ETA text then omits minutes.
 */
export async function lookupDriveMinutes(
  origin: GeoPoint | null,
  address: string,
  propertyPoint: GeoPoint | null,
): Promise<number | null> {
  if (!origin) {
    return null
  }

  const key = process.env.GOOGLE_MAPS_API_KEY?.trim()
  if (key) {
    const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json")
    url.searchParams.set("origins", `${origin.lat},${origin.lng}`)
    url.searchParams.set("destinations", address)
    url.searchParams.set("mode", "driving")
    url.searchParams.set("units", "imperial")
    url.searchParams.set("key", key)
    try {
      const response = await fetch(url, { cache: "no-store" })
      if (response.ok) {
        const minutes = minutesFromDistanceMatrix(await response.json())
        if (minutes) {
          return minutes
        }
      }
    } catch {
      // Fall through to the straight-line estimate.
    }
  }

  if (propertyPoint) {
    return estimateDriveMinutes(
      haversineMiles(origin.lat, origin.lng, propertyPoint.lat, propertyPoint.lng),
    )
  }

  return null
}
