import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { IpRateLimiter, ROOM_INFO_PER_MIN, clientIp } from "@/lib/rate-limit";
import { roomExpired } from "@/lib/room-ttl";
import { creatorTokenMatches } from "@/lib/creator-token";
import { readJsonBody } from "@/lib/api-body";
import { createKeyBundleV2 } from "@/lib/kdf";

// PUT /api/rooms/:roomId/password. Rotate the room's entry key by
// changing its password. Creator-only: the creator token authorizes
// the change. A new argon2id key bundle is derived from the new
// password and stored as the room's verifier, replacing the old one.
// Members who hold the new password can unlock; members who only know
// the old password can no longer derive the entry key.
//
// The entry key (kv 1) is re-installed on each client from the new
// bundle. Key versions above 1 (random rotation keys) are unaffected:
// they were delivered pairwise over ECDH and never derived from the
// password.
//
// Rate-limited like the verifier route: this is a write path that
// also doubles as an existence oracle for the room.
const passwordLimiter = new IpRateLimiter({ limit: ROOM_INFO_PER_MIN, windowMs: 60_000 });

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  if (!passwordLimiter.allow(clientIp(request))) {
    return NextResponse.json({ error: "slow-down" }, { status: 429 });
  }
  const { roomId } = await params;
  const read = await readJsonBody<{
    password?: string;
    creatorToken?: string;
  }>(request);
  if (!read.ok) {
    if (read.reason === "too-large") {
      return NextResponse.json({ error: "body-too-large" }, { status: 413 });
    }
    return NextResponse.json({ error: "invalid-password" }, { status: 400 });
  }
  const body = read.body;
  if (typeof body.password !== "string" || body.password.length === 0) {
    return NextResponse.json({ error: "invalid-password" }, { status: 400 });
  }
  const room = await db.room.findUnique({ where: { id: roomId } });
  if (!room || room.burned || roomExpired(room.expiresAt)) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  if (
    typeof body.creatorToken !== "string" ||
    !(await creatorTokenMatches(room.creatorToken, body.creatorToken))
  ) {
    return NextResponse.json({ error: "not-authorized" }, { status: 403 });
  }
  // Derive a fresh argon2id bundle from the new password. The bundle
  // carries a random salt and memory-hard parameters; the join
  // verifier is an HMAC over the derivation output, bound to this
  // room.
  const { bundle, joinVerifier } = await createKeyBundleV2(body.password, roomId);
  await db.room.update({
    where: { id: roomId },
    data: { verifier: JSON.stringify(bundle), joinProof: joinVerifier },
  });
  return NextResponse.json({ ok: true });
}
