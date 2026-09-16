import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// PUT /api/rooms/:roomId/verifier — the creator stores an encrypted
// known-plaintext blob. Joiners derive their key and try to decrypt it:
// success = right password, failure = wrong password. The server still
// learns nothing. Can only be set once.
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await params;
  const body = (await request.json().catch(() => null)) as {
    verifier?: string;
  } | null;
  if (!body?.verifier || typeof body.verifier !== "string" || body.verifier.length > 512) {
    return NextResponse.json({ error: "invalid-verifier" }, { status: 400 });
  }
  const room = await db.room.findUnique({ where: { id: roomId } });
  if (!room || room.burned) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  if (room.verifier) {
    // Already sealed — idempotent no-op for the rightful creator.
    return NextResponse.json({ ok: true, alreadySealed: true });
  }
  await db.room.update({ where: { id: roomId }, data: { verifier: body.verifier } });
  return NextResponse.json({ ok: true });
}
