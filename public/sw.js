/* CipherChat service worker — installability without retention.
 *
 * The product's promise: nothing of the conversation persists here.
 * Message content lives only in browser memory (never in responses
 * we could cache), so this worker deliberately caches no API
 * responses, no navigations' bodies beyond the shell, and nothing
 * under socket.io. It exists so the app installs and launches
 * instantly — not so it remembers.
 */

const VERSION = "cipherchat-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;

/* Immutable build output and static assets — safe to hold. */
const ASSET_PATTERNS = [
  /\/_next\/static\//,
  /\/icons\//,
  /\/icon\.svg$/,
  /\/manifest\.webmanifest$/,
  /\/fonts\//,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(["/icons/icon-192.png", "/manifest.webmanifest"]).catch(() => {}))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => !k.startsWith(VERSION))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  /* The relay and the API are always live — never cached, never
   * served stale. Ephemerality is the product. */
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/socket.io/")) {
    return;
  }

  /* Cross-origin stays out of our caches entirely. */
  if (url.origin !== self.location.origin) return;

  /* Static assets: stale-while-revalidate — instant launch, quiet
   * refresh behind the scenes. */
  if (ASSET_PATTERNS.some((p) => p.test(url.pathname))) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const refresh = fetch(request)
          .then((res) => {
            if (res.ok) cache.put(request, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached ?? refresh;
      }),
    );
    return;
  }

  /* Everything else (pages, data-less shell): network-first with a
   * cached copy only when offline. */
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok && request.mode === "navigate") {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(request).then((cached) => cached ?? Response.error()),
      ),
  );
});
