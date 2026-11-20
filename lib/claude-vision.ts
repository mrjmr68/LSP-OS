import "server-only"

/** One photo + one instruction to Claude; returns the text reply or a plain error. */
export async function askAboutPhoto(
  dataUrl: string,
  prompt: string,
): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  const key = process.env.ANTHROPIC_API_KEY?.trim()
  if (!key) return { ok: false, message: "Scanning isn't set up yet (no AI key). Type the numbers." }
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/)
  if (!match) return { ok: false, message: "That photo didn't come through. Try again." }
  if (match[2]!.length > 1_200_000) return { ok: false, message: "That photo is too large. Try again closer in." }
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5-5",
        max_tokens: 500,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: match[1], data: match[2] } },
              { type: "text", text: prompt },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) {
      console.error("Photo read failed", response.status)
      return { ok: false, message: "Couldn't read it this time. Type the numbers, or try again." }
    }
    const body = (await response.json()) as { content?: { type: string; text?: string }[] }
    return { ok: true, text: body.content?.find((c) => c.type === "text")?.text ?? "" }
  } catch {
    return { ok: false, message: "No connection to the reader. Type the numbers." }
  }
}
