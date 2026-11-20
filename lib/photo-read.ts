// Shrinks a camera photo for reading by AI: sharp enough for small print, under the upload limit.

/** Big enough to read small print, small enough to send: 1600 px, JPEG. */
export async function prepareForReading(file: File): Promise<string> {
  try {
    const bitmap = await createImageBitmap(file)
    for (const [edge, quality] of [
      [1600, 0.82],
      [1280, 0.75],
      [1024, 0.7],
    ] as const) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement("canvas")
      canvas.width = Math.round(bitmap.width * scale)
      canvas.height = Math.round(bitmap.height * scale)
      const ctx = canvas.getContext("2d")
      if (!ctx) return ""
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const url = canvas.toDataURL("image/jpeg", quality)
      if (url.length < 900_000) return url
    }
    return ""
  } catch {
    return ""
  }
}
