import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// POST /api/rooms/:roomId/leave — a member leaves. The room epoch is
// bumped so every remaining member rotates the room key (re-deriving
// from their in-memory password). The leaver keeps no key material.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await params;
  const body = (await request.json().catch(() => null)) as {
    memberId?: string;
  } | null;
  if (!body?.memberId) {
    return NextResponse.json({ error: "invalid-member" }, { status: 400 });
  }
  const room = await db.room.findUnique({ where: { id: roomId } });
  if (!room || room.burned) {
    return NextResponse.json({ ok: true, epoch: room?.epoch ?? 0 });
  }
  await db.member.updateMany({
    where: { id: body.memberId, roomId },
    data: { active: false },
  });
  const updated = await db.room.update({
    where: { id: roomId },
    data: { epoch: { increment: 1 } },
  });
  return NextResponse.json({ ok: true, epoch: updated.epoch });
}
