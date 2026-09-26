import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { IpRateLimiter, ROOM_CREATE_PER_MIN } from "@/lib/rate-limit";
import {
  parseRoomTtlSec,
  roomExpired,
  ROOM_TTL_DEFAULT_SEC,
} from "@/lib/room-ttl";

// Crockford base32, no I/L/O/U: codes that survive being read aloud
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

// POST /api/rooms. Create a room. The server never learns the password:
// the client derives the key locally and later stores only a verifier blob.
// Body: { ttlSec?: number } - the room's lifetime chosen by its creator
// (0 = no expiry, "until burned"). Expired rooms are swept here: this is
// the one write-heavy moment on the calendar, so the janitor rides along.
export async function POST(request: Request) {
  if (!createLimiter.allow(clientIp(request))) {
    return NextResponse.json({ error: "slow-down" }, { status: 429 });
  }
  const body = (await request.json().catch(() => null)) as { ttlSec?: unknown } | null;
  const parsed = body?.ttlSec === undefined ? { ok: true, ttlSec: ROOM_TTL_DEFAULT_SEC } : parseRoomTtlSec(body.ttlSec);
  if (!parsed.ok) {
    return NextResponse.json({ error: "invalid-ttl" }, { status: 400 });
  }
  // The janitor: rooms whose time ran out leave now (members cascade).
  // Cheap and idempotent: no cron, no timer, just tidiness on the way in.
  await db.room.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = makeRoomId();
    const existing = await db.room.findUnique({ where: { id } });
    if (existing && !roomExpired(existing.expiresAt)) continue;
    const room = await db.room.create({
      data: {
        id,
        creatorToken: makeToken(),
        epoch: 1,
        expiresAt: parsed.ttlSec
          ? new Date(Date.now() + parsed.ttlSec * 1000)
          : null,
      },
    });
    return NextResponse.json(
      {
        roomId: room.id,
        creatorToken: room.creatorToken,
        epoch: room.epoch,
        expiresAt: room.expiresAt?.toISOString() ?? null,
      },
      { status: 201 },
    );
  }
  return NextResponse.json({ error: "room-id-collision" }, { status: 500 });
}
