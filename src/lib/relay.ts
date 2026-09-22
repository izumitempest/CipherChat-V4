// The relay client — one socket, many rooms. The URL is configuration,
// never code: same-origin "/relay/" by default (your reverse proxy
// strips the prefix and forwards it to the relay service — see
// deploy/), or any absolute https URL. See .env.example for
// NEXT_PUBLIC_RELAY_URL.

import { io, type Socket } from "socket.io-client";

const RELAY_URL = process.env.NEXT_PUBLIC_RELAY_URL || "/relay/";

export interface RelayTarget {
  /**
   * Absolute origin ("https://relay.example.com") for remote relays,
   * null for same-origin paths.
   */
  origin: string | null;
  /**
   * The engine.io REQUEST path. The relay server is configured with
   * socket.io `path: "/"` (see mini-services/relay-service/index.ts —
   * "DO NOT change the path"), which accepts engine.io requests on ANY
   * path, so the request path belongs to the PROXY in front of it:
   * "/relay/" behind the compose Caddy (handle_path strips the prefix,
   * the relay sees "/"), "/" on the sandbox gateway (routing is by
   * query — XTransformPort=3003 — which is preserved verbatim below).
   */
  path: string;
  /**
   * Verbatim query string ("XTransformPort=3003"), no leading "?".
   * Empty string when the URL has none.
   */
  query: string;
}

/**
 * Split a NEXT_PUBLIC_RELAY_URL value into the socket.io-client
 * options that actually reach the wire.
 *
 * Why this exists: socket.io-client v4 treats a URL's path as a
 * NAMESPACE (`io("/relay/")` asks the server for the "/relay/"
 * namespace — the relay only registers "/"), while its engine.io
 * requests always go to `opts.path` (default "/socket.io/"). The
 * URL's path must therefore be handed over as the `path` OPTION, or
 * the requests bypass the proxy route and the namespace does not
 * exist. This is the second bug the compose E2E caught (after the
 * Prisma engine mismatch): the golden path died with the socket never
 * connecting through Caddy.
 */
export function parseRelayTarget(raw: string): RelayTarget {
  const absolute = /^https?:\/\//i.test(raw);
  // A dummy base makes relative paths parseable; it is only consulted
  // for the (unused) origin when the URL is relative.
  const parsed = new URL(raw, "http://relay.invalid");
  return {
    origin: absolute ? `${parsed.protocol}//${parsed.host}` : null,
    path: parsed.pathname || "/",
    query: parsed.search.replace(/^\?/, ""),
  };
}

let socket: Socket | null = null;

export function getRelay(): Socket {
  if (!socket) {
    const target = parseRelayTarget(RELAY_URL);
    socket = io(target.origin ?? undefined, {
      // The engine.io request path (see RelayTarget.path). engine.io
      // normalizes the trailing slash itself, so "/relay" and "/relay/"
      // both reach the relay as "/" after the prefix strip.
      path: target.path,
      // The sandbox gateway routes by query, not path — keep every pair
      // ("XTransformPort=3003"), never in the path. socket.io-client's
      // option type wants an object; engine.io serializes it back onto
      // the request URL.
      ...(target.query
        ? { query: Object.fromEntries(new URLSearchParams(target.query)) }
        : {}),
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 900,
      reconnectionDelayMax: 4000,
      timeout: 10_000,
    });
  }
  return socket;
}

export function destroyRelay(): void {
  socket?.disconnect();
  socket = null;
}
