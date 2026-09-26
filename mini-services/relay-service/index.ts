import { createServer } from "http";
import { Server, Socket } from "socket.io";
import {
  TokenBucket,
  RELAY_FRAME_RATE,
  RELAY_FRAME_BURST,
  frameSizeWithinCap,
} from "../../src/lib/rate-limit";

/**
 * CipherChat relay: the server only forwards frames.
 *
 * This service holds no database and no message history. It keeps a
 * room-scoped presence table in memory and forwards opaque padded
 * encrypted frames between members. It cannot read anything it relays.
 *
 * Hardening (Task 19.6):
 *   - every socket gets a token bucket: sustained 20 frames/sec with a
 *     bounded burst. Floods are dropped, not relayed
 *   - any socket message over the frame-size cap is a protocol
 *     violation and disconnects the socket (memory-DoS guard)
 *   - a socket may join at most 16 rooms
 *
 * Silent-departure grace (Task 21.1):
 *   - when a member's LAST socket drops we stamp wentOfflineAt, so
 *     the presence snapshot can tell the REST layer not just WHO is
 *     offline but for how long (the eviction grace floor)
 *   - GET /presence/:roomId on the INTERNAL port (3004, token-guarded,
 *     never routed through the gateway) is the authoritative source for
 *     connected sockets that the /evict route consults before writing
 *     anyone out
 *   - member:expired is the coordinator's REST-confirmed announcement
 *     that a silent leaver was evicted. Receivers verify against
 *     the registry before acting, exactly as with member:left
 */

const MAX_ROOMS_PER_SOCKET = 16;

const httpServer = createServer();
const io = new Server(httpServer, {
  // DO NOT change the path: Caddy uses it to forward requests.
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

// "roomId:memberId" -> epoch ms when their last socket dropped. Set on
// silent departure, cleared on any return (join / clean leave). This is
// the clock behind the eviction grace floor. REST asks, the relay answers.
const wentOfflineAt = new Map<string, number>();

function presenceKey(roomId: string, memberId: string) {
  return `${roomId}:${memberId}`;
}

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

  /** Enforce the hard size cap. Violations disconnect the socket. */
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
        return; // room spam, silently ignored
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
      wentOfflineAt.delete(presenceKey(roomId, memberId)); // they came back

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
      // Protocol violation: hard disconnect (memory-DoS guard).
      console.warn(`[relay] oversized frame from ${socket.id}, disconnecting`);
      socket.disconnect(true);
      return;
    }
    if (!frameAllowed()) return; // over budget, dropped
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

  // Early burn: the author burns their own message before it expires.
  // The sig is checked by receivers against the author's registered key.
  // The relay only forwards frames and cannot forge one.
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

  // Typing notice: "someone is writing", transient, never stored.
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
    if (!frameAllowed()) return; // unauthenticated event, at least rate-limit it
    for (const s of memberSockets(data.roomId, socket.id)) {
      s.emit("member:left", { roomId: data.roomId, memberId: data.memberId, alias: data.alias });
    }
    socket.leave(`room:${data.roomId}`);
    removeFromRoom(data.roomId, data.memberId, socket.id);
    // A clean leave is not a silent one, so no grace clock starts.
    wentOfflineAt.delete(presenceKey(data.roomId, data.memberId));
  });

  // The coordinator's announcement that a silent leaver was evicted
  // server-side (REST-confirmed before it ever got here). Receivers
  // re-confirm against the registry before evicting/rotating. The
  // relay only forwards frames and is not an authority.
  socket.on(
    "member:expired",
    (data: { roomId: string; memberId: string; alias: string }) => {
      if (!data?.roomId || !data?.memberId) return;
      if (!frameAllowed()) return;
      for (const s of memberSockets(data.roomId, socket.id)) {
        s.emit("member:expired", { roomId: data.roomId, memberId: data.memberId, alias: data.alias });
      }
    },
  );

  socket.on("room:burn", (data: { roomId: string }) => {
    if (!data?.roomId) return;
    if (!frameAllowed()) return;
    for (const s of memberSockets(data.roomId, socket.id)) {
      s.emit("room:burned", { roomId: data.roomId });
    }
    rooms.delete(data.roomId);
    for (const key of [...wentOfflineAt.keys()]) {
      if (key.startsWith(`${data.roomId}:`)) wentOfflineAt.delete(key);
    }
    console.log(`[relay] room ${data.roomId} burned`);
  });

  socket.on("disconnect", () => {
    for (const key of joined) {
      const [roomId, memberId] = key.split(":");
      const stillConnected = removeFromRoom(roomId, memberId, socket.id);
      if (!stillConnected) {
        // Silent departure: start the grace clock the /evict route
        // will later consult.
        wentOfflineAt.set(presenceKey(roomId, memberId), Date.now());
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

/* ------------------------------------------------------------------ *
 * INTERNAL PRESENCE SNAPSHOT (port 3004): the authoritative source
 * for connected sockets, consulted by the REST /evict route. Not
 * routed through the gateway; guarded by a shared token so only the
 * API tier can ask. Failures on this port never affect message relay.
 * ------------------------------------------------------------------ */

const INTERNAL_PORT = 3004;
const INTERNAL_TOKEN = process.env.RELAY_INTERNAL_TOKEN ?? "";

function terminateRoom(roomId: string) {
  for (const s of memberSockets(roomId)) {
    s.emit("room:burned", { roomId });
  }
  rooms.delete(roomId);
  for (const key of [...wentOfflineAt.keys()]) {
    if (key.startsWith(`${roomId}:`)) wentOfflineAt.delete(key);
  }
  console.log(`[relay] room ${roomId} terminated (internal)`);
}

createServer((req, res) => {
  const url = req.url ?? "";

  // POST /terminate/:roomId: the abuse path's relay half. The REST
  // /report route calls this after it has burned the room in the
  // registry, so connected members hear "room:burned" (the event
  // every client already runs its burn sequence on) instead of
  // typing into a dead room until their next poll. Same token guard
  // as presence; never routed through the gateway.
  if (url.startsWith("/terminate/") && req.method === "POST") {
    if (req.headers["x-internal-token"] !== INTERNAL_TOKEN) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "forbidden" }));
      return;
    }
    const roomId = url.slice("/terminate/".length).split("?")[0];
    terminateRoom(roomId);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (!url.startsWith("/presence/")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not-found" }));
    return;
  }
  if (req.method !== "GET" || req.headers["x-internal-token"] !== INTERNAL_TOKEN) {
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "forbidden" }));
    return;
  }
  const roomId = url.slice("/presence/".length).split("?")[0];
  const room = rooms.get(roomId);
  const connected = room ? Array.from(room.keys()) : [];
  const offlineSince: Record<string, number> = {};
  for (const [key, ts] of wentOfflineAt) {
    const sep = key.indexOf(":");
    if (key.slice(0, sep) === roomId) offlineSince[key.slice(sep + 1)] = ts;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ roomId, connected, offlineSince }));
}).listen(INTERNAL_PORT, () => {
  console.log(
    `[relay] presence snapshot on :${INTERNAL_PORT} ${INTERNAL_TOKEN ? "(token armed)" : "(NO TOKEN, /evict will fail closed)"}`,
  );
});
