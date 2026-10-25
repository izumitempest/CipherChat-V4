import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { terminateRoomOnRelay } from "@/lib/relay-admin";

// POST /api/rooms/:roomId/burn. Creator-only termination.
// Destroys the room and its member registry for everyone, unrecoverably.
// The member wipe and the burned flag flip run in ONE transaction: a
// crash between two separate writes used to leave a room with no
// members but burned=false — a half-dead registry clients would
// half-trust. After the commit, the token-guarded internal channel
// tells the relay, which broadcasts "room:burned" (the event every
// client runs its burn sequence on). The relay no longer accepts a
// client-emitted room:burn — that path was unauthenticated and let
// anyone holding an invite link kill every member's live session.
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
  await db.$transaction([
    db.member.deleteMany({ where: { roomId } }),
    db.room.update({
      where: { id: roomId },
      data: { burned: true, burnedAt: new Date(), verifier: null },
    }),
  ]);
  await terminateRoomOnRelay(roomId);
  return NextResponse.json({ ok: true });
}
