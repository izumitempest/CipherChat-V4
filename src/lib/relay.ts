// The relay client — one socket, many rooms. The URL is configuration,
// never code: same-origin "/relay/" by default (your reverse proxy
// forwards it to the relay service — see deploy/), or any absolute
// https URL. See .env.example for NEXT_PUBLIC_RELAY_URL.

import { io, type Socket } from "socket.io-client";

const RELAY_URL = process.env.NEXT_PUBLIC_RELAY_URL || "/relay/";

let socket: Socket | null = null;

export function getRelay(): Socket {
  if (!socket) {
    // A trailing-slash path (e.g. "/relay/") becomes the engine.io
    // request path; the relay service answers on "/" behind a prefix-
    // stripping proxy, so no other options are needed.
    socket = io(RELAY_URL, {
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
