import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { IpRateLimiter, ROOM_INFO_PER_MIN, clientIp } from "@/lib/rate-limit";
import { roomExpired } from "@/lib/room-ttl";
import { verifyJoinProof } from "@/lib/join-proof";
import { readJsonBody } from "@/lib/api-body";
import { makeSocketToken, SOCKET_TOKEN_TTL_MS } from "@/lib/socket-token";

// POST /api/rooms/:roomId/socket-token. Issues a short-lived socket
// token that the client presents to the relay when joining a room.
// Requires a join proof (password holder) and a member id. Returns a
// token valid for 5 minutes. The relay verifies the token using the
// shared RELAY_INTERNAL_TOKEN and binds the socket to the member id
// inside, so a client cannot claim another member's id.
//
// Rate-limited per IP like room info.
const tokenLimiter = new IpRateLimiter({ limit: ROOM_INFO_PER_MIN, windowMs: 60_000 });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  if (!tokenLimiter.allow(clientIp(request))) {
    return NextResponse.json({ error: "slow-down" }, { status: 429 });
  }
  const { roomId } = await params;
  const room = await db.room.findUnique({ where: { id: roomId } });
  if (!room || room.burned || roomExpired(room.expiresAt)) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  // Join proof required: only password holders get socket tokens.
  if (room.joinProof) {
    const joinOk = await verifyJoinProof(
      room.joinProof,
      request.headers.get("x-join-proof"),
      roomId,
    );
    if (!joinOk) {
      return NextResponse.json({ error: "join-proof-required" }, { status: 403 });
    }
  }
  const secret = process.env.RELAY_INTERNAL_TOKEN ?? "";
  if (!secret) {
    return NextResponse.json({ error: "not-configured" }, { status: 500 });
  }
  const read = await readJsonBody<{ memberId?: string }>(request);
  if (!read.ok) {
    if (read.reason === "too-large") {
      return NextResponse.json({ error: "body-too-large" }, { status: 413 });
    }
    return NextResponse.json({ error: "invalid-token-request" }, { status: 400 });
  }
  const body = read.body;
  if (typeof body.memberId !== "string" || body.memberId.length === 0) {
    return NextResponse.json({ error: "invalid-token-request" }, { status: 400 });
  }
  // Optionally verify the member exists in the registry (active).
  const member = await db.member.findFirst({
    where: { id: body.memberId, roomId, active: true },
  });
  if (!member) {
    return NextResponse.json({ error: "member-not-found" }, { status: 404 });
  }
  const token = await makeSocketToken(secret, roomId, body.memberId);
  return NextResponse.json({ token, expiresIn: SOCKET_TOKEN_TTL_MS });
}
