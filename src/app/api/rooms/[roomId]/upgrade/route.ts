import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { IpRateLimiter, ROOM_INFO_PER_MIN, clientIp } from "@/lib/rate-limit";
import { roomExpired } from "@/lib/room-ttl";
import { creatorTokenMatches } from "@/lib/creator-token";
import { readJsonBody } from "@/lib/api-body";
import { createKeyBundleV2 } from "@/lib/kdf";

// PUT /api/rooms/:roomId/upgrade. Upgrade a legacy room (sealed before
// the join-proof existed) to protocol v2: store a fresh argon2id key
// bundle and join verifier, so joining thereafter requires proof of the
// password. Creator-only: the creator token authorizes the change.
//
// Legacy rooms carry a versionless PBKDF2 blob (or no verifier at all)
// and no joinProof, so they keep the old rule: anyone with the link can
// register and the roster is readable. This route lets the creator
// close that gap by sealing a v2 bundle and join verifier, after which
// joins require a join proof and the roster is behind it.
//
// The creator supplies the room password; the client derives the bundle
// locally and sends it here. The server never learns the password or
// the room key.
const upgradeLimiter = new IpRateLimiter({ limit: ROOM_INFO_PER_MIN, windowMs: 60_000 });

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  if (!upgradeLimiter.allow(clientIp(request))) {
    return NextResponse.json({ error: "slow-down" }, { status: 429 });
  }
  const { roomId } = await params;
  const read = await readJsonBody<{
    verifier?: string;
    creatorToken?: string;
    joinProof?: string;
  }>(request);
  if (!read.ok) {
    if (read.reason === "too-large") {
      return NextResponse.json({ error: "body-too-large" }, { status: 413 });
    }
    return NextResponse.json({ error: "invalid-upgrade" }, { status: 400 });
  }
  const body = read.body;
  if (!body?.verifier || typeof body.verifier !== "string" || body.verifier.length > 512) {
    return NextResponse.json({ error: "invalid-upgrade" }, { status: 400 });
  }
  let bundle: unknown;
  try {
    bundle = JSON.parse(body.verifier);
  } catch {
    bundle = null;
  }
  const bundleOk =
    !!bundle &&
    typeof bundle === "object" &&
    (bundle as { v?: unknown }).v === 2 &&
    (bundle as { alg?: unknown }).alg === "argon2id";
  if (!bundleOk) {
    return NextResponse.json({ error: "invalid-upgrade" }, { status: 400 });
  }
  const room = await db.room.findUnique({ where: { id: roomId } });
  if (!room || room.burned || roomExpired(room.expiresAt)) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  // Only legacy rooms (no join proof) can be upgraded. A room that
  // already has a join proof is already on protocol v2.
  if (room.joinProof) {
    return NextResponse.json({ ok: true, alreadyUpgraded: true });
  }
  if (
    typeof body.creatorToken !== "string" ||
    !(await creatorTokenMatches(room.creatorToken, body.creatorToken))
  ) {
    return NextResponse.json({ error: "not-authorized" }, { status: 403 });
  }
  const joinProof =
    typeof body.joinProof === "string" && body.joinProof.length > 0 && body.joinProof.length <= 128
      ? body.joinProof
      : null;
  await db.room.update({
    where: { id: roomId },
    data: { verifier: body.verifier, joinProof },
  });
  return NextResponse.json({ ok: true });
}
