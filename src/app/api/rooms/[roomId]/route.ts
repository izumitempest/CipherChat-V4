import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ROOM_MEMBER_CAP } from "../route";

// GET /api/rooms/:roomId — public room info for the invite surface.
// Returns only what a stranger at an invite link needs. No secrets.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
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
