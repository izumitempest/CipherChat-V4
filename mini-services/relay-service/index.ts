import { createServer } from "http";
import { Server, Socket } from "socket.io";
import {
  TokenBucket,
  RELAY_FRAME_RATE,
  RELAY_FRAME_BURST,
  frameSizeWithinCap,
} from "../../src/lib/rate-limit";

/**
 * CipherChat relay — a blind post office.
 *
 * This service holds no database and no message history. It keeps a
 * room-scoped presence table in memory and forwards opaque padded
 * encrypted frames between members. It cannot read anything it relays.
 *
 * Hardening (Task 19.6):
 *   - every socket gets a token bucket: sustained 20 frames/sec with a
 *     bounded burst — floods are dropped, not relayed
 *   - any socket message over the frame-size cap is a protocol
 *     violation and disconnects the socket (memory-DoS guard)
 *   - a socket may join at most 16 rooms
 */

const MAX_ROOMS_PER_SOCKET = 16;

const httpServer = createServer();
const io = new Server(httpServer, {
  // DO NOT change the path — Caddy uses it to forward requests.
  path: "/",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1_000_000, // frame-size cap is enforced per message below
});

interface MemberInfo {
  memberId: string;
  alias: string;
  colorIdx: number;
  pubkey?: unknown; // signing key (JWK) so others can verify messages
  ecdhPub?: string; // session ECDH public key (raw b64) for key delivery
}

// roomId -> (memberId -> { info, sockets:Set<socketId> })
const rooms = new Map<string, Map<string, { info: MemberInfo; sockets: Set<string> }>>();

function roomMembers(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return [];
  return Array.from(room.values()).map(({ info }) => ({ ...info, connected: true }));
}

function memberSockets(roomId: string, exceptSocketId?: string): Socket[] {
  const room = rooms.get(roomId);
  if (!room) return [];
  const out: Socket[] = [];
  for (const { sockets } of room.values()) {
    for (const sid of sockets) {
      if (sid !== exceptSocketId) {
        const s = io.sockets.sockets.get(sid);
        if (s) out.push(s);
      }
    }
  }
  return out;
}

io.on("connection", (socket) => {
  // socket.id -> list of { roomId, memberId } this socket joined
  const joined = new Set<string>();
  const bucket = new TokenBucket({ ratePerSec: RELAY_FRAME_RATE, capacity: RELAY_FRAME_BURST });

  /** Enforce the per-socket frame budget. Returns false when the
   *  frame should be dropped. */
  function frameAllowed(): boolean {
    return bucket.tryTake();
  }

  /** Enforce the hard size cap — violations disconnect the socket. */
  function withinSizeCap(data: unknown): boolean {
    try {
      return frameSizeWithinCap(JSON.stringify(data ?? {}));
    } catch {
      return false;
    }
  }

  socket.on(
    "room:join",
    (data: {
      roomId: string;
      memberId: string;
      alias: string;
      colorIdx: number;
      pubkey?: unknown;
      ecdhPub?: string;
      rejoined?: boolean;
    }) => {
      if (!data?.roomId || !data?.memberId || typeof data.alias !== "string") return;
      if (!withinSizeCap(data)) {
        socket.disconnect(true);
        return;
      }
      if (joined.size >= MAX_ROOMS_PER_SOCKET && !joined.has(`${data.roomId}:${data.memberId}`)) {
        return; // room spam — silently ignored
      }
      const { roomId, memberId, alias, colorIdx } = data;
      let room = rooms.get(roomId);
      if (!room) {
        room = new Map();
        rooms.set(roomId, room);
      }
      let entry = room.get(memberId);
      const isNewMember = !entry;
      if (!entry) {
        entry = {
          info: { memberId, alias, colorIdx: colorIdx ?? 0, pubkey: data.pubkey, ecdhPub: data.ecdhPub },
          sockets: new Set(),
        };
        room.set(memberId, entry);
      } else {
        // alias may have been refined; keep registry fresh
        entry.info.alias = alias;
        entry.info.colorIdx = colorIdx ?? entry.info.colorIdx;
        if (data.pubkey) entry.info.pubkey = data.pubkey;
        if (data.ecdhPub) entry.info.ecdhPub = data.ecdhPub;
      }
      entry.sockets.add(socket.id);
      joined.add(`${roomId}:${memberId}`);
      socket.join(`room:${roomId}`);

      socket.emit("room:state", { roomId, members: roomMembers(roomId) });
      if (isNewMember) {
        for (const s of memberSockets(roomId, socket.id)) {
          s.emit("member:joined", { roomId, member: entry.info, rejoined: !!data.rejoined });
        }
      } else {
        for (const s of memberSockets(roomId, socket.id)) {
          s.emit("member:presence", { roomId, memberId, connected: true });
        }
      }
      console.log(`[relay] ${alias} (${memberId.slice(-6)}) ${isNewMember ? "joined" : "re-joined"} room ${roomId}`);
    },
  );

  socket.on("message:send", (data: { roomId: string; envelope: unknown }) => {
    if (!data?.roomId || !data?.envelope) return;
    if (!withinSizeCap(data)) {
      // Protocol violation — hard disconnect (memory-DoS guard).
      console.warn(`[relay] oversized frame from ${socket.id} — disconnecting`);
      socket.disconnect(true);
      return;
    }
    if (!frameAllowed()) return; // over budget — dropped
    const envelope = data.envelope as { id?: string };
    for (const s of memberSockets(data.roomId, socket.id)) {
      s.emit("message:new", { roomId: data.roomId, envelope: data.envelope });
    }
    socket.emit("message:ack", { id: envelope?.id, roomId: data.roomId });
  });

  socket.on("message:spent", (data: { roomId: string; messageId: string }) => {
    if (!data?.roomId || !data?.messageId) return;
    if (!frameAllowed()) return;
    for (const s of memberSockets(data.roomId, socket.id)) {
      s.emit("message:spent", { roomId: data.roomId, messageId: data.messageId });
    }
  });

  // Early burn: the author retires their own letter ahead of its clock.
  // The sig is checked by receivers against the author's registered key —
  // the relay stays blind and cannot forge one.
  socket.on(
    "message:burn",
    (data: { roomId: string; messageId: string; senderId?: string; sig?: string }) => {
      if (!data?.roomId || !data?.messageId) return;
      if (!frameAllowed()) return;
      for (const s of memberSockets(data.roomId, socket.id)) {
        s.emit("message:burn", {
          roomId: data.roomId,
          messageId: data.messageId,
          senderId: data.senderId,
          sig: data.sig,
        });
      }
    },
  );

  // Presence whispers: "someone is writing" — transient, never stored.
  // (Protocol v2 clients send typing as ordinary encrypted frames; this
  // handler remains for pre-upgrade clients.)
  socket.on(
    "member:typing",
    (data: { roomId: string; memberId: string; alias: string }) => {
      if (!data?.roomId || !data?.memberId) return;
      if (!frameAllowed()) return;
      for (const s of memberSockets(data.roomId, socket.id)) {
        s.emit("member:typing", {
          roomId: data.roomId,
          memberId: data.memberId,
          alias: data.alias,
        });
      }
    },
  );

  // A member stuck on an old key version asks for delivery. Members
  // answer with ECDH-wrapped offers; the relay still sees nothing.
  socket.on("key:request", (data: { roomId: string; from?: string }) => {
    if (!data?.roomId) return;
    if (!frameAllowed()) return;
    for (const s of memberSockets(data.roomId, socket.id)) {
      s.emit("key:request", { roomId: data.roomId, from: data.from });
    }
  });

  socket.on("member:leave", (data: { roomId: string; memberId: string; alias: string }) => {
    if (!data?.roomId || !data?.memberId) return;
    if (!frameAllowed()) return; // unauthenticated event — at least rate-limit it
    for (const s of memberSockets(data.roomId, socket.id)) {
      s.emit("member:left", { roomId: data.roomId, memberId: data.memberId, alias: data.alias });
    }
    socket.leave(`room:${data.roomId}`);
    removeFromRoom(data.roomId, data.memberId, socket.id);
  });

  socket.on("room:burn", (data: { roomId: string }) => {
    if (!data?.roomId) return;
    if (!frameAllowed()) return;
    for (const s of memberSockets(data.roomId, socket.id)) {
      s.emit("room:burned", { roomId: data.roomId });
    }
    rooms.delete(data.roomId);
    console.log(`[relay] room ${data.roomId} burned`);
  });

  socket.on("disconnect", () => {
    for (const key of joined) {
      const [roomId, memberId] = key.split(":");
      const stillConnected = removeFromRoom(roomId, memberId, socket.id);
      if (!stillConnected) {
        for (const s of memberSockets(roomId)) {
          s.emit("member:presence", { roomId, memberId, connected: false });
        }
      }
    }
  });

  socket.on("error", (err) => console.error(`[relay] socket error:`, err));
});

function removeFromRoom(roomId: string, memberId: string, socketId: string): boolean {
  const room = rooms.get(roomId);
  if (!room) return false;
  const entry = room.get(memberId);
  if (!entry) return false;
  entry.sockets.delete(socketId);
  if (entry.sockets.size === 0) {
    room.delete(memberId);
  }
  if (room.size === 0) rooms.delete(roomId);
  return room.has(memberId);
}

const PORT = 3003;
httpServer.listen(PORT, () => {
  console.log(`[relay] CipherChat blind relay listening on :${PORT}`);
});
