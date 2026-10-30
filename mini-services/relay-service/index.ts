import { createServer } from "http";
import { timingSafeEqual } from "node:crypto";
import { Server, Socket } from "socket.io";
import {
  TokenBucket,
  RELAY_FRAME_RATE,
  RELAY_FRAME_BURST,
  RELAY_BYTE_RATE,
  RELAY_BYTE_BURST,
  frameSizeWithinCap,
} from "../../src/lib/rate-limit";
import { SocketMembership } from "../../src/lib/relay-binding";

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
/** members the relay will hold for one room. The app's own cap is
 *  far lower (eight), but the relay does not know that and must not
 *  let a socket plant thousands of member ids in one room. */
const MAX_MEMBERS_PER_ROOM = 64;

/**
 * Who may open a socket.
 *
 * The relay used to answer every origin ("*"). The relay holds no
 * content, but it does hold the room map and the presence table, and
 * a page on any site could open a socket, join a room it knows the id
 * of, and read the presence and the frames it is sent. The frames are
 * encrypted, so the worst a stranger gets is the room's membership
 * and their traffic shape. Still, the relay has no business serving
 * a page that is not the app.
 *
 * The list comes from RELAY_ALLOWED_ORIGINS (comma separated). With
 * nothing set, the defaults are the local app and the deployed site.
 * The dev origins the QA gateway uses are allowed too, or the preview
 * would not work, and so are the onion addresses, because Tor
 * generates that address at runtime and the operator cannot list it
 * before the first boot.
 */
function allowedOrigins(): string[] {
  const raw = process.env.RELAY_ALLOWED_ORIGINS ?? "";
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length) return list;
  const out = ["http://localhost:3000", "http://127.0.0.1:3000"];
  const site = process.env.CADDY_SITE;
  if (site) {
    out.push(`https://${site}`);
    out.push(`http://${site}`);
  }
  return out;
}

// The origins that cannot be listed by name: the QA gateway and the
// preview tunnels in front of the local dev server, and the onion
// address Tor writes on the first boot.
const PATTERN_ORIGINS = [/\.space-z\.ai$/i, /\.trycloudflare\.com$/i, /\.onion$/i];

function originAllowed(origin: string): boolean {
  if (allowedOrigins().includes(origin)) return true;
  return PATTERN_ORIGINS.some((re) => re.test(origin));
}

const httpServer = createServer();
const io = new Server(httpServer, {
  // DO NOT change the path: Caddy uses it to forward requests.
  path: "/",
  cors: {
    origin: (origin, callback) => {
      // No Origin header: not a browser (a health check, a script).
      if (!origin) {
        callback(null, true);
        return;
      }
      callback(null, originAllowed(origin));
    },
    methods: ["GET", "POST"],
  },
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
  // The member ids this socket claimed, per room. The relay takes the
  // member id from the JOIN and keeps it; every later event uses the
  // bound id, never one the client types. A client used to be able to
  // announce that somebody else left, or speak as somebody else.
  const bound = new SocketMembership();
  const bucket = new TokenBucket({ ratePerSec: RELAY_FRAME_RATE, capacity: RELAY_FRAME_BURST });
  // The byte bucket. Frames per second was not a limit on traffic: a
  // frame can be 128 KB, so 20 frames a second was 2.5 MB a second.
  const bytes = new TokenBucket({ ratePerSec: RELAY_BYTE_RATE, capacity: RELAY_BYTE_BURST });

  /** Enforce the per-socket frame budget. Returns false when the
   *  frame should be dropped. */
  function frameAllowed(): boolean {
    return bucket.tryTake();
  }

  /** Enforce the per-socket byte budget, charged with the frame's
   *  own size. */
  function bytesAllowed(size: number): boolean {
    return bytes.tryTake(size);
  }

  /** The member id this socket holds for a room, or null when it has
   *  not joined that room. */
  function memberIdFor(roomId: string): string | null {
    return bound.memberIdFor(roomId);
  }

  /** Enforce the hard size cap. Violations disconnect the socket.
   *  Returns the frame's size in bytes, or null when the frame is
   *  over the cap. */
  function frameSize(data: unknown): number | null {
    try {
      const json = JSON.stringify(data ?? {});
      if (!frameSizeWithinCap(json)) return null;
      return json.length;
    } catch {
      return null;
    }
  }

  function withinSizeCap(data: unknown): boolean {
    return frameSize(data) !== null;
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
        if (room.size >= MAX_MEMBERS_PER_ROOM) {
          // The relay's room map is memory. A socket that joins with
          // fresh member ids must not be able to grow it without
          // bound. The room keeps its members; the new one is refused.
          console.warn(`[relay] room ${roomId} is at its member cap, join refused`);
          return;
        }
        entry = {
          info: { memberId, alias, colorIdx: colorIdx ?? 0, pubkey: data.pubkey, ecdhPub: data.ecdhPub },
          sockets: new Set(),
        };
        room.set(memberId, entry);
      } else {
        // A re-join refreshes the alias (it may have been refined) but
        // NEVER the identity keys: identity (pubkey, ECDH) flows from
        // the REST registry, which is keyed by pubkey and cannot be
        // overwritten by a forged join. Allowing the socket path to
        // rewrite them here once let any connection that quoted a
        // memberId replace that member's keys in relay broadcasts.
        //
        // The alias is the relay's own copy of what the client said.
        // The REST roster is the authority, and the client cannot
        // change the alias there any more (it is derived from the
        // public key), so this value only has to agree with it.
        entry.info.alias = alias;
        entry.info.colorIdx = colorIdx ?? entry.info.colorIdx;
      }
      entry.sockets.add(socket.id);
      joined.add(`${roomId}:${memberId}`);
      bound.join(roomId, memberId);
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
    const size = frameSize(data);
    if (size === null) {
      // Protocol violation: hard disconnect (memory-DoS guard).
      console.warn(`[relay] oversized frame from ${socket.id}, disconnecting`);
      socket.disconnect(true);
      return;
    }
    // The sender has to be in the room. A socket that never joined
    // used to be able to push frames into any room it knew the id of.
    if (!memberIdFor(data.roomId)) return;
    if (!frameAllowed()) return; // over budget, dropped
    if (!bytesAllowed(size)) return; // over the byte budget, dropped
    const envelope = data.envelope as { id?: string };
    for (const s of memberSockets(data.roomId, socket.id)) {
      s.emit("message:new", { roomId: data.roomId, envelope: data.envelope });
    }
    socket.emit("message:ack", { id: envelope?.id, roomId: data.roomId });
  });

  socket.on("message:spent", (data: { roomId: string; messageId: string }) => {
    if (!data?.roomId || !data?.messageId) return;
    if (!memberIdFor(data.roomId)) return;
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
      if (!memberIdFor(data.roomId)) return;
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
      // The member id and the alias come from the relay's own record
      // of this socket, not from the client. A client used to be able
      // to type under somebody else's name.
      const memberId = memberIdFor(data.roomId);
      if (!memberId) return;
      if (!frameAllowed()) return;
      const room = rooms.get(data.roomId);
      const known = room?.get(memberId)?.info;
      for (const s of memberSockets(data.roomId, socket.id)) {
        s.emit("member:typing", {
          roomId: data.roomId,
          memberId,
          alias: known?.alias ?? data.alias,
        });
      }
    },
  );

  // A member stuck on an old key version asks for delivery. Members
  // answer with ECDH-wrapped offers; the relay still sees nothing.
  socket.on("key:request", (data: { roomId: string; from?: string }) => {
    if (!data?.roomId) return;
    const from = memberIdFor(data.roomId);
    if (!from) return;
    if (!frameAllowed()) return;
    for (const s of memberSockets(data.roomId, socket.id)) {
      s.emit("key:request", { roomId: data.roomId, from });
    }
  });

  socket.on("member:leave", (data: { roomId: string; memberId: string; alias: string }) => {
    if (!data?.roomId || !data?.memberId) return;
    // The member id is the one this socket holds for the room. A
    // client used to be able to announce that somebody else left,
    // which moved a live member's presence clock.
    const memberId = memberIdFor(data.roomId);
    if (!memberId) return;
    if (!frameAllowed()) return; // unauthenticated event, at least rate-limit it
    const room = rooms.get(data.roomId);
    const known = room?.get(memberId)?.info;
    for (const s of memberSockets(data.roomId, socket.id)) {
      s.emit("member:left", { roomId: data.roomId, memberId, alias: known?.alias ?? data.alias });
    }
    socket.leave(`room:${data.roomId}`);
    removeFromRoom(data.roomId, memberId, socket.id);
    bound.leave(data.roomId);
    // A clean leave is not a silent one, so no grace clock starts.
    wentOfflineAt.delete(presenceKey(data.roomId, memberId));
  });

  // The coordinator's announcement that a silent leaver was evicted
  // server-side (REST-confirmed before it ever got here). Receivers
  // re-confirm against the registry before evicting/rotating. The
  // relay only forwards frames and is not an authority.
  socket.on(
    "member:expired",
    (data: { roomId: string; memberId: string; alias: string }) => {
      if (!data?.roomId || !data?.memberId) return;
      // Same rule as the leave: the relay speaks for the member the
      // socket holds, not for the id the client typed.
      const memberId = memberIdFor(data.roomId);
      if (!memberId) return;
      if (!frameAllowed()) return;
      const room = rooms.get(data.roomId);
      const known = room?.get(memberId)?.info;
      for (const s of memberSockets(data.roomId, socket.id)) {
        s.emit("member:expired", { roomId: data.roomId, memberId, alias: known?.alias ?? data.alias });
      }
    },
  );

  // Room termination is NOT a client-facing event. The old handler
  // broadcast "room:burned" and deleted relay room state on any
  // socket's say-so — no token, no signature — which handed anyone
  // holding an invite link (the weakest credential in the system) a
  // one-event kill switch over every member's live session. Authority
  // lives server-side now: REST /burn (creator token) calls the
  // token-guarded /terminate/:roomId below,
  // which is the ONLY thing that emits "room:burned".
  socket.on("room:burn", (data: { roomId?: string }) => {
    console.warn(
      `[relay] ignored unauthenticated room:burn from ${socket.id} (room ${data?.roomId ?? "?"})`,
    );
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

/** Auth for the internal ports. Refuses EVERYTHING when the token is
 *  unset (an empty header value must never match an unset token — the
 *  old `!==` comparison let `X-Internal-Token:` with an empty value
 *  through exactly then), and compares in constant time when set. */
function internalTokenOk(header: unknown): boolean {
  if (!INTERNAL_TOKEN || typeof header !== "string") return false;
  const a = Buffer.from(header);
  const b = Buffer.from(INTERNAL_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

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

  // POST /terminate/:roomId: the burn path's relay half. The REST
  // /burn route calls this after it has burned the room in the
  // registry, so connected members hear "room:burned" (the event
  // every client already runs its burn sequence on) instead of
  // typing into a dead room until their next poll. Same token guard
  // as presence; never routed through the gateway.
  if (url.startsWith("/terminate/") && req.method === "POST") {
    if (!internalTokenOk(req.headers["x-internal-token"])) {
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
  if (req.method !== "GET" || !internalTokenOk(req.headers["x-internal-token"])) {
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
    `[relay] presence snapshot on :${INTERNAL_PORT} ${INTERNAL_TOKEN ? "(token armed)" : "(NO TOKEN: internal port refuses everything)"}`,
  );
});
