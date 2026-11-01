import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Legend Service Pros",
    short_name: "LSP",
    description: "Board for Legend Service Pros field service.",
    start_url: "/board",
    scope: "/",
    display: "standalone",
    background_color: "#f4f0e6",
    theme_color: "#1c3330",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  }
}
