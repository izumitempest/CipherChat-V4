import { createServer } from "http";
import { Server, Socket } from "socket.io";

/**
 * CipherChat relay — a blind post office.
 *
 * This service holds no database and no message history. It keeps a
 * room-scoped presence table in memory and forwards opaque encrypted
 * envelopes between members. It cannot read anything it relays.
 */

const httpServer = createServer();
const io = new Server(httpServer, {
  // DO NOT change the path — Caddy uses it to forward requests.
  path: "/",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 8_000_000, // room for encrypted file envelopes (≤2MB files)
});

interface MemberInfo {
  memberId: string;
  alias: string;
  colorIdx: number;
  pubkey?: unknown; // signing key (JWK) so others can verify messages
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

  socket.on(
    "room:join",
    (data: { roomId: string; memberId: string; alias: string; colorIdx: number; pubkey?: unknown; rejoined?: boolean }) => {
      if (!data?.roomId || !data?.memberId || typeof data.alias !== "string") return;
      const { roomId, memberId, alias, colorIdx } = data;
      let room = rooms.get(roomId);
      if (!room) {
        room = new Map();
        rooms.set(roomId, room);
      }
      let entry = room.get(memberId);
      const isNewMember = !entry;
      if (!entry) {
        entry = { info: { memberId, alias, colorIdx: colorIdx ?? 0, pubkey: data.pubkey }, sockets: new Set() };
        room.set(memberId, entry);
      } else {
        // alias may have been refined; keep registry fresh
        entry.info.alias = alias;
        entry.info.colorIdx = colorIdx ?? entry.info.colorIdx;
        if (data.pubkey) entry.info.pubkey = data.pubkey;
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
    const envelope = data.envelope as { id?: string };
    for (const s of memberSockets(data.roomId, socket.id)) {
      s.emit("message:new", { roomId: data.roomId, envelope: data.envelope });
    }
    socket.emit("message:ack", { id: envelope?.id, roomId: data.roomId });
  });

  socket.on("message:spent", (data: { roomId: string; messageId: string }) => {
    if (!data?.roomId || !data?.messageId) return;
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
  socket.on(
    "member:typing",
    (data: { roomId: string; memberId: string; alias: string }) => {
      if (!data?.roomId || !data?.memberId) return;
      for (const s of memberSockets(data.roomId, socket.id)) {
        s.emit("member:typing", {
          roomId: data.roomId,
          memberId: data.memberId,
          alias: data.alias,
        });
      }
    },
  );

  socket.on("member:leave", (data: { roomId: string; memberId: string; alias: string }) => {
    if (!data?.roomId || !data?.memberId) return;
    for (const s of memberSockets(data.roomId, socket.id)) {
      s.emit("member:left", { roomId: data.roomId, memberId: data.memberId, alias: data.alias });
    }
    socket.leave(`room:${data.roomId}`);
    removeFromRoom(data.roomId, data.memberId, socket.id);
  });

  socket.on("room:burn", (data: { roomId: string }) => {
    if (!data?.roomId) return;
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
