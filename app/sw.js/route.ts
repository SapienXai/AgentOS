const SERVICE_WORKER_CLEANUP = `
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.registration.unregister(),
      caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
    ])
  );
});
`;

export function GET() {
  return new Response(SERVICE_WORKER_CLEANUP, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Content-Type": "application/javascript; charset=utf-8",
      "Service-Worker-Allowed": "/"
    }
  });
}
