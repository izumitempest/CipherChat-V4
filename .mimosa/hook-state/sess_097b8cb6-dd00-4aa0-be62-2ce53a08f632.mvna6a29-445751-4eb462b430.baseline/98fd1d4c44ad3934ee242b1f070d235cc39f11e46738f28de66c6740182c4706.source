/* CipherChat service worker — installability without retention.
 *
 * The product's promise: nothing of the conversation persists here.
 * Message content lives only in browser memory (never in responses
 * we could cache), so this worker deliberately caches no API
 * responses and nothing under the relay path. It exists so the app
 * installs and launches instantly — not so it remembers.
 *
 * Update flow (Task 22): bump VERSION on every release. The browser
 * byte-compares /sw.js on navigation, installs the new worker, which
 * skips waiting and claims clients immediately; the page then shows
 * an update prompt (never an automatic reload — a half-written draft
 * outranks freshness) and old caches are swept on activate.
 */

const VERSION = "cipherchat-v4";
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;

/* Immutable build output and static assets — safe to hold. */
const ASSET_PATTERNS = [
  /\/_next\/static\//,
  /\/icons\//,
  /\/legal\//,
  /\/icon\.svg$/,
  /\/logo\.svg$/,
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
      .then(() => self.clients.claim())
      // Tell every open page a new seal took over. The page decides
      // how to surface it (SwRegister shows the reload prompt).
      .then(() =>
        self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
          for (const client of clients) {
            client.postMessage({ type: "cipherchat:updated", version: VERSION });
          }
        }),
      ),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

/* A tapped notification returns to its room. Focus an open window
 * and tell it to navigate (the hash router takes it from there — a
 * locked room shows its unlock sheet, a first-class state); with no
 * window open, launch straight into the room. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const roomId = event.notification.data?.roomId;
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clientList) {
        if (
          "focus" in client &&
          new URL(client.url).origin === self.location.origin
        ) {
          await client.focus();
          if (roomId) {
            client.postMessage({ type: "cipherchat:navigate", roomId });
          }
          return;
        }
      }
      return self.clients.openWindow(roomId ? `/#/r/${roomId}` : "/");
    })(),
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
