import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { IpRateLimiter, ROOM_INFO_PER_MIN, clientIp } from "@/lib/rate-limit";
import { roomExpired } from "@/lib/room-ttl";
import { argon2ParamsWithinLimits } from "@/lib/kdf-limits";

// PUT /api/rooms/:roomId/verifier. The CREATOR stores an encrypted
// known-plaintext blob. Joiners derive their key and try to decrypt it:
// success = right password, failure = wrong password. The server still
// learns nothing.
//
// Sealing requires the creatorToken. This route used to be
// unauthenticated: anyone who learned a roomId could win the
// first-write race (the create flow deliberately spends >=1.7s between
// room creation and this PUT) and seal the room under a password of
// their own — every legitimate joiner would then fail to unlock,
// forever, with no way to fix it. The token closes the race: only the
// party that created the room can say what its password check is.
//
// The bundle's argon2id parameters are also validated against the
// shared kdf-limits policy (clients clamp on unlock as defense in
// depth): a hostile bundle must not be able to store m=8/t=1 and make
// every future offline guess a thousand times cheaper than policy.
//
// Can only be set once. Rate-limited per IP like room info: PUTs
// against this route are an oracle for room existence (and a write
// path), so excess is refused.
const verifierLimiter = new IpRateLimiter({ limit: ROOM_INFO_PER_MIN, windowMs: 60_000 });

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
    creatorToken?: string;
  } | null;
  if (!body?.verifier || typeof body.verifier !== "string" || body.verifier.length > 512) {
    return NextResponse.json({ error: "invalid-verifier" }, { status: 400 });
  }
  // New seals must be version-2 argon2id bundles within policy bounds
  // (legacy v1 rooms already carry their versionless blob; nobody
  // writes those anymore).
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
    (bundle as { alg?: unknown }).alg === "argon2id" &&
    argon2ParamsWithinLimits(bundle as Parameters<typeof argon2ParamsWithinLimits>[0]);
  if (!bundleOk) {
    return NextResponse.json({ error: "invalid-verifier" }, { status: 400 });
  }
  const room = await db.room.findUnique({ where: { id: roomId } });
  if (!room || room.burned || roomExpired(room.expiresAt)) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  if (
    typeof body.creatorToken !== "string" ||
    body.creatorToken !== room.creatorToken
  ) {
    return NextResponse.json({ error: "not-authorized" }, { status: 403 });
  }
  if (room.verifier) {
    // Already set. Idempotent no-op for the rightful creator.
    return NextResponse.json({ ok: true, alreadySealed: true });
  }
  await db.room.update({ where: { id: roomId }, data: { verifier: body.verifier } });
  return NextResponse.json({ ok: true });
}
