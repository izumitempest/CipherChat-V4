import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { IpRateLimiter, ROOM_INFO_PER_MIN } from "@/lib/rate-limit";
import { roomExpired } from "@/lib/room-ttl";

// PUT /api/rooms/:roomId/verifier. The creator stores an encrypted
// known-plaintext blob. Joiners derive their key and try to decrypt it:
// success = right password, failure = wrong password. The server still
// learns nothing. Can only be set once.
//
// Rate-limited per IP like room info: PUTs against this route are an
// oracle for room existence (and a write path), so excess is refused.
const verifierLimiter = new IpRateLimiter({ limit: ROOM_INFO_PER_MIN, windowMs: 60_000 });

function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "local";
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  if (!verifierLimiter.allow(clientIp(request))) {
    return NextResponse.json({ error: "slow-down" }, { status: 429 });
  }
  const { roomId } = await params;
  const body = (await request.json().catch(() => null)) as {
    verifier?: string;
  } | null;
  if (!body?.verifier || typeof body.verifier !== "string" || body.verifier.length > 512) {
    return NextResponse.json({ error: "invalid-verifier" }, { status: 400 });
  }
  const room = await db.room.findUnique({ where: { id: roomId } });
  if (!room || room.burned || roomExpired(room.expiresAt)) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  if (room.verifier) {
    // Already set. Idempotent no-op for the rightful creator.
    return NextResponse.json({ ok: true, alreadySealed: true });
  }
  await db.room.update({ where: { id: roomId }, data: { verifier: body.verifier } });
  return NextResponse.json({ ok: true });
}
