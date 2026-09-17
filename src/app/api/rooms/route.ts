import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { IpRateLimiter, ROOM_CREATE_PER_MIN } from "@/lib/rate-limit";

// Crockford base32, no I/L/O/U — codes that survive being read aloud
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function makeRoomId(len = 10): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

function makeToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// The member cap lives in lib/admission.ts (pure, property-tested).
// Re-exported here so existing import sites keep working.
export { ROOM_MEMBER_CAP } from "@/lib/admission";

// Room creation is rate-limited per IP (SQLite bloat / spam guard).
const createLimiter = new IpRateLimiter({ limit: ROOM_CREATE_PER_MIN, windowMs: 60_000 });

function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "local";
}

// POST /api/rooms — create a room. The server never learns the password:
// the client derives the key locally and later stores only a verifier blob.
export async function POST(request: Request) {
  if (!createLimiter.allow(clientIp(request))) {
    return NextResponse.json({ error: "slow-down" }, { status: 429 });
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = makeRoomId();
    const existing = await db.room.findUnique({ where: { id } });
    if (existing) continue;
    const room = await db.room.create({
      data: { id, creatorToken: makeToken(), epoch: 1 },
    });
    return NextResponse.json(
      { roomId: room.id, creatorToken: room.creatorToken, epoch: room.epoch },
      { status: 201 },
    );
  }
  return NextResponse.json({ error: "room-id-collision" }, { status: 500 });
}
