// Minimal worker so the Board can be installed. It does not cache crew data.
// Offline visit drafts are a later milestone.

self.addEventListener("install", () => {
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return
  }
  event.respondWith(fetch(event.request))
})
