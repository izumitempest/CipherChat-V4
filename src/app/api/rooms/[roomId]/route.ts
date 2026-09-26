import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { IpRateLimiter, ROOM_INFO_PER_MIN } from "@/lib/rate-limit";
import { ROOM_MEMBER_CAP } from "@/lib/admission";
import { parseRoomTtlSec, roomExpired } from "@/lib/room-ttl";

// GET /api/rooms/:roomId. Public room info for the invite surface.
// Returns only what a stranger at an invite link needs. No secrets.
// Rate-limited per IP: this endpoint is an existence/epoch oracle, so
// unbounded scraping is refused rather than served. A room whose time
// has run out is reported as gone, because it is.
const infoLimiter = new IpRateLimiter({ limit: ROOM_INFO_PER_MIN, windowMs: 60_000 });

function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "local";
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  if (!infoLimiter.allow(clientIp(request))) {
    return NextResponse.json({ error: "slow-down" }, { status: 429 });
  }
  const { roomId } = await params;
  const room = await db.room.findUnique({
    where: { id: roomId },
    include: { members: { where: { active: true } } },
  });
  if (!room || room.burned) {
    return NextResponse.json({ exists: false, burned: !!room?.burned }, { status: 404 });
  }
  if (roomExpired(room.expiresAt)) {
    return NextResponse.json({ exists: false, expired: true }, { status: 404 });
  }
  return NextResponse.json({
    exists: true,
    burned: false,
    epoch: room.epoch,
    verifier: room.verifier,
    memberCount: room.members.length,
    memberCap: ROOM_MEMBER_CAP,
    createdAt: room.createdAt,
    expiresAt: room.expiresAt?.toISOString() ?? null,
  });
}

// PATCH /api/rooms/:roomId. The creator adjusts the room's lifetime
// while it lives. Requires the creator token (held only by the room's
// creator, never on the server beyond the hash-comparable original).
// Body: { creatorToken: string, ttlSec: number } (0 = until burned).
// A room whose time has already run out cannot be resurrected.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await params;
  const body = (await request.json().catch(() => null)) as {
    creatorToken?: unknown;
    ttlSec?: unknown;
  } | null;
  if (typeof body?.creatorToken !== "string" || body.creatorToken.length === 0) {
    return NextResponse.json({ error: "not-authorized" }, { status: 403 });
  }
  const parsed = parseRoomTtlSec(body.ttlSec);
  if (!parsed.ok) {
    return NextResponse.json({ error: "invalid-ttl" }, { status: 400 });
  }
  const room = await db.room.findUnique({ where: { id: roomId } });
  if (!room || room.burned) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  if (roomExpired(room.expiresAt)) {
    return NextResponse.json({ error: "room-expired" }, { status: 410 });
  }
  if (body.creatorToken !== room.creatorToken) {
    return NextResponse.json({ error: "not-authorized" }, { status: 403 });
  }
  const expiresAt = parsed.ttlSec
    ? new Date(Date.now() + parsed.ttlSec * 1000)
    : null;
  await db.room.update({ where: { id: roomId }, data: { expiresAt } });
  return NextResponse.json({ ok: true, expiresAt: expiresAt?.toISOString() ?? null });
}
