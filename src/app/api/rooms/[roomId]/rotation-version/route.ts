import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { IpRateLimiter, ROOM_INFO_PER_MIN, clientIp } from "@/lib/rate-limit";
import { roomExpired } from "@/lib/room-ttl";
import { verifyJoinProof } from "@/lib/join-proof";
import { readJsonBody } from "@/lib/api-body";

// GET /api/rooms/:roomId/rotation-version. Hands out the next server-
// assigned rotation version and atomically increments it. Requires a
// join proof so only password holders can request versions.
//
// Clients call this before rotating to get a server-assigned version,
// eliminating the collision risk of self-assigned versions
// (epoch * SPAN + random offset, 1-in-4-billion collision).
//
// Rate-limited per IP like room info: this is a read path that also
// mutates state, so excess is refused.
const versionLimiter = new IpRateLimiter({ limit: ROOM_INFO_PER_MIN, windowMs: 60_000 });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  if (!versionLimiter.allow(clientIp(request))) {
    return NextResponse.json({ error: "slow-down" }, { status: 429 });
  }
  const { roomId } = await params;
  const room = await db.room.findUnique({ where: { id: roomId } });
  if (!room || room.burned || roomExpired(room.expiresAt)) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  // The join proof gates access: only a password holder can request
  // a rotation version. Rooms sealed before the proof existed have no
  // verifier and keep the old rule (self-assigned versions).
  if (room.joinProof) {
    const joinOk = await verifyJoinProof(
      room.joinProof,
      request.headers.get("x-join-proof"),
      roomId,
    );
    if (!joinOk) {
      return NextResponse.json({ error: "join-proof-required" }, { status: 403 });
    }
  }
  // Atomically increment and return the previous value as the handed-
  // out version. Two concurrent requests get different versions.
  const updated = await db.room.update({
    where: { id: roomId },
    data: { rotationVersion: { increment: 1 } },
    select: { rotationVersion: true },
  });
  // The version handed out is the value before the increment: if the
  // stored value was 0, hand out 0 and store 1, so the next caller
  // gets 1. Version 0 means "not yet issued" — clients treat it as
  // "use self-assignment" until they receive a nonzero version.
  const handedOut = updated.rotationVersion - 1;
  return NextResponse.json({ version: handedOut });
}
