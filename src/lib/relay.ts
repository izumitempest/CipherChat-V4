// The relay client — one socket, many rooms. All URLs are relative;
// the gateway carries us to the relay port via XTransformPort.

import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getRelay(): Socket {
  if (!socket) {
    socket = io("/?XTransformPort=3003", {
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
