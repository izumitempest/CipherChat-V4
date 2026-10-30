import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { IpRateLimiter, ROOM_INFO_PER_MIN, clientIp } from "@/lib/rate-limit";
import { sweepRooms } from "@/lib/janitor";
import { ROOM_MEMBER_CAP } from "@/lib/admission";
import { parseRoomTtlSec, roomExpired } from "@/lib/room-ttl";
import { creatorTokenMatches, hashCreatorToken, isPlainCreatorToken } from "@/lib/creator-token";
import { readJsonBody } from "@/lib/api-body";

// GET /api/rooms/:roomId. Public room info for the invite surface.
// Returns only what a stranger at an invite link needs. No secrets.
// Rate-limited per IP (rightmost XFF hop — see rate-limit.ts): this
// endpoint is an existence/epoch oracle, so unbounded scraping is
// refused rather than served. A room whose time has run out is
// reported as gone, because it is. The janitor rides along here too:
// on a quiet server nobody creates rooms, and expired/burned rows
// must still leave the registry eventually.
const infoLimiter = new IpRateLimiter({ limit: ROOM_INFO_PER_MIN, windowMs: 60_000 });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  if (!infoLimiter.allow(clientIp(request))) {
    return NextResponse.json({ error: "slow-down" }, { status: 429 });
  }
  // Tidiness ride-along (rate-limit-bounded frequency, fire-and-forget).
  void sweepRooms();
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
// while it lives. Requires the creator token, which the creator holds
// and the server stores only as a hash (sha256, domain separated),
// compared in constant time. A database dump does not yield a working
// token. Body: { creatorToken: string, ttlSec: number } (0 = until
// burned). A room whose time has already run out cannot be
// resurrected.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await params;
  const read = await readJsonBody<{ creatorToken?: unknown; ttlSec?: unknown }>(request);
  if (!read.ok) {
    if (read.reason === "too-large") {
      return NextResponse.json({ error: "body-too-large" }, { status: 413 });
    }
    return NextResponse.json({ error: "invalid-body" }, { status: 400 });
  }
  const body = read.body;
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
  if (!(await creatorTokenMatches(room.creatorToken, body.creatorToken))) {
    return NextResponse.json({ error: "not-authorized" }, { status: 403 });
  }
  // Rooms sealed before the token was hashed store it plain; the first
  // successful use replaces it with the hash.
  if (isPlainCreatorToken(room.creatorToken)) {
    await db.room.update({
      where: { id: roomId },
      data: { creatorToken: await hashCreatorToken(body.creatorToken) },
    });
  }
  const expiresAt = parsed.ttlSec
    ? new Date(Date.now() + parsed.ttlSec * 1000)
    : null;
  await db.room.update({ where: { id: roomId }, data: { expiresAt } });
  return NextResponse.json({ ok: true, expiresAt: expiresAt?.toISOString() ?? null });
}
