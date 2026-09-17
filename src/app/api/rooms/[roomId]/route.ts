import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { IpRateLimiter, ROOM_INFO_PER_MIN } from "@/lib/rate-limit";
import { ROOM_MEMBER_CAP } from "@/lib/admission";

// GET /api/rooms/:roomId — public room info for the invite surface.
// Returns only what a stranger at an invite link needs. No secrets.
// Rate-limited per IP: this endpoint is an existence/epoch oracle, so
// unbounded scraping is refused rather than served.
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
  return NextResponse.json({
    exists: true,
    burned: false,
    epoch: room.epoch,
    verifier: room.verifier,
    memberCount: room.members.length,
    memberCap: ROOM_MEMBER_CAP,
    createdAt: room.createdAt,
  });
}
