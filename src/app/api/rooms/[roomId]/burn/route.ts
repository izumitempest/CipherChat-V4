import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// POST /api/rooms/:roomId/burn. Creator-only termination.
// Destroys the room and its member registry for everyone, unrecoverably.
// The socket layer announces it; every client runs the burn sequence.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await params;
  const body = (await request.json().catch(() => null)) as {
    creatorToken?: string;
  } | null;
  const room = await db.room.findUnique({ where: { id: roomId } });
  if (!room) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  if (room.burned) {
    return NextResponse.json({ ok: true, alreadyBurned: true });
  }
  if (!body?.creatorToken || body.creatorToken !== room.creatorToken) {
    return NextResponse.json({ error: "not-authorized" }, { status: 403 });
  }
  await db.member.deleteMany({ where: { roomId } });
  await db.room.update({
    where: { id: roomId },
    data: { burned: true, burnedAt: new Date(), verifier: null },
  });
  return NextResponse.json({ ok: true });
}
