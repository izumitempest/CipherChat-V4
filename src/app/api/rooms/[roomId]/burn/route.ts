import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { terminateRoomOnRelay } from "@/lib/relay-admin";
import { creatorTokenMatches, hashCreatorToken, isPlainCreatorToken } from "@/lib/creator-token";
import { readJsonBody } from "@/lib/api-body";

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
  const read = await readJsonBody<{ creatorToken?: string }>(request);
  if (!read.ok) {
    if (read.reason === "too-large") {
      return NextResponse.json({ error: "body-too-large" }, { status: 413 });
    }
    return NextResponse.json({ error: "not-authorized" }, { status: 403 });
  }
  const body = read.body;
  const room = await db.room.findUnique({ where: { id: roomId } });
  if (!room) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  if (room.burned) {
    return NextResponse.json({ ok: true, alreadyBurned: true });
  }
  if (!(await creatorTokenMatches(room.creatorToken, body?.creatorToken))) {
    return NextResponse.json({ error: "not-authorized" }, { status: 403 });
  }
  // A room sealed before the token was hashed stores it plain. The
  // first successful burn replaces it with the hash.
  if (isPlainCreatorToken(room.creatorToken) && typeof body?.creatorToken === "string") {
    await db.room.update({
      where: { id: roomId },
      data: { creatorToken: await hashCreatorToken(body.creatorToken) },
    });
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
