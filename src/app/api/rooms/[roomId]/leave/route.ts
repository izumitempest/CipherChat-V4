import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { IpRateLimiter } from "@/lib/rate-limit";
import { verifyLeaveProof } from "@/lib/leave-proof";
import { roomExpired } from "@/lib/room-ttl";

// POST /api/rooms/:roomId/leave. A member leaves, PROVING POSSESSION of
// the room signing key: the request carries {memberId, ts, sig}, and we
// verify the signature against the pubkey registered for that member
// before writing anyone out. A bare memberId (a server-issued handle a
// relay observer or invite-code holder could have learned) is no longer
// enough to rotate the room out from under everyone. The room epoch is
// bumped so every remaining member rotates the room key (re-deriving
// from their in-memory password). The leaver keeps no key material.
const leaveLimiter = new IpRateLimiter({ limit: 20, windowMs: 60_000 });

function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "local";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  if (!leaveLimiter.allow(clientIp(request))) {
    return NextResponse.json({ error: "slow-down" }, { status: 429 });
  }
  const { roomId } = await params;
  const body = (await request.json().catch(() => null)) as {
    memberId?: string;
    ts?: number;
    sig?: string;
  } | null;
  if (!body?.memberId || typeof body.ts !== "number" || typeof body.sig !== "string") {
    return NextResponse.json({ error: "invalid-proof" }, { status: 400 });
  }
  const room = await db.room.findUnique({ where: { id: roomId } });
  if (!room || room.burned || roomExpired(room.expiresAt)) {
    return NextResponse.json({ ok: true, epoch: room?.epoch ?? 0 });
  }
  const member = await db.member.findFirst({
    where: { id: body.memberId, roomId },
  });
  if (!member) {
    return NextResponse.json({ ok: true, epoch: room.epoch });
  }
  let pubkey: unknown;
  try {
    pubkey = JSON.parse(member.pubkey);
  } catch {
    return NextResponse.json({ error: "bad-proof" }, { status: 403 });
  }
  if (!(await verifyLeaveProof(pubkey, body.sig, roomId, body.memberId, body.ts))) {
    return NextResponse.json({ error: "bad-proof" }, { status: 403 });
  }
  // Idempotent: replaying a captured proof against an already-inactive
  // member is a no-op. The epoch bumps at most once per departure
  // (nuisance rotation would require a VALID signature from the
  // member's own key, i.e. the victim's own leave button).
  if (member.active) {
    await db.member.updateMany({
      where: { id: member.id, roomId },
      data: { active: false },
    });
    const updated = await db.room.update({
      where: { id: roomId },
      data: { epoch: { increment: 1 } },
    });
    return NextResponse.json({ ok: true, epoch: updated.epoch });
  }
  return NextResponse.json({ ok: true, epoch: room.epoch });
}
