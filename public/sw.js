// Minimal service worker: it exists so the app can be installed (SPEC §7).
// There's deliberately no fetch handler and no caching, since the app needs
// a connection and always shows live data.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
