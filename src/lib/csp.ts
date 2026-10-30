// The Content-Security-Policy.
//
// One nonce per request, made in the middleware and handed to Next
// through the x-nonce header. Next puts it on the scripts it injects,
// so the policy can name a nonce instead of waving every inline script
// through with 'unsafe-inline'.
//
// Styles still need 'unsafe-inline': React writes inline styles, and
// the app uses them on purpose (the composer grows with its draft,
// the sheets slide on their own track).
//
// The relay is the one other place the browser talks to, so its
// websocket origin goes into connect-src. It is read from the same
// env var the client uses, so the two cannot drift.
//
// See bugs/BUGS.md B15.

function relayWsOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_RELAY_URL || "";
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    const url = new URL(raw);
    return `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`;
  } catch {
    return null;
  }
}

export function buildCsp(nonce: string, dev: boolean): string {
  // The app fetches its own blob URLs (the file viewer reads the
  // decrypted bytes back out of the blob it made).
  const connect = ["'self'", "blob:"];
  const relay = relayWsOrigin();
  if (relay) connect.push(relay);
  // In dev the hot-reload socket and the overlay need room.
  if (dev) connect.push("ws:", "wss:");

  const parts = [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    // Next's bootstrap script carries the nonce; everything it loads
    // comes from this origin.
    `script-src 'self' 'nonce-${nonce}'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    // The file viewer shows pictures through blob URLs, and the app
    // has inline images (the empty-state seal).
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    `connect-src ${connect.join(" ")}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ];
  // In production every page is https, so the browser may push its
  // own http subresources up. In dev the app runs on http://localhost
  // and that would break the dev relay.
  if (!dev) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}
