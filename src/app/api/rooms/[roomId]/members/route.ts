import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  IpRateLimiter,
  clientIp,
  MEMBER_FRESH_WINDOW_MS,
  MEMBER_JOIN_PER_MIN,
} from "@/lib/rate-limit";
import { decideAdmission } from "@/lib/admission";
import { roomExpired } from "@/lib/room-ttl";
import { verifyMemberProof } from "@/lib/member-proof";
import { verifyJoinProof } from "@/lib/join-proof";
import { readJsonBody } from "@/lib/api-body";
import { aliasFromFingerprint, inkFromFingerprint, sha256Hex } from "@/lib/identity";

// POST /api/rooms/:roomId/members. Join (or re-join after a refresh).
// Identity is the public key: same key = same alias, same color.
// Keys are PER-ROOM (derived from the device seed), so the registry
// cannot be correlated across rooms.
//
// Joining writes a NEW row, so it needs no proof of the password: the
// row is new and nobody is taken over. It does need a JOIN PROOF when
// the room has one: an HMAC over the key derivation output, bound to
// the room, which only somebody who knows the password can make. The
// server keeps that verifier and never publishes it. See join-proof.ts.
//
// Updating an EXISTING row needs the member proof. The roster is
// public, so a stranger can read a member's pubkey and post it back;
// before the member proof, that post reactivated the member and
// replaced its ECDH key, which is the key a key offer is encrypted to.
// The update now carries a signature from the member's own registered
// key over the room and the new ECDH key. See bugs/BUGS.md B6.
const joinLimiter = new IpRateLimiter({ limit: MEMBER_JOIN_PER_MIN, windowMs: 60_000 });

// Input ceilings: every field written into the registry is bounded,
// because the registry is world-readable (GET below) and SQLite rows
// are cheap to bloat. A 10 MB "alias" must not become one.
const ALIAS_MAX = 64;
const PUBKEY_JSON_MAX = 2_048;

function isJwk(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as any).kty === "string" &&
    typeof (value as any).x === "string" &&
    typeof (value as any).y === "string"
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  if (!joinLimiter.allow(clientIp(request))) {
    return NextResponse.json({ error: "slow-down" }, { status: 429 });
  }
  const { roomId } = await params;
  const read = await readJsonBody<{
    pubkey?: unknown;
    ecdhPub?: unknown;
    alias?: unknown;
    colorIdx?: unknown;
    proof?: { ts?: unknown; sig?: unknown };
    joinProof?: unknown;
  }>(request);
  if (!read.ok) {
    if (read.reason === "too-large") {
      return NextResponse.json({ error: "body-too-large" }, { status: 413 });
    }
    return NextResponse.json({ error: "invalid-member" }, { status: 400 });
  }
  const body = read.body;

  const ecdhPubOk =
    body?.ecdhPub === undefined ||
    (typeof body.ecdhPub === "string" && body.ecdhPub.length > 0 && body.ecdhPub.length <= 200);

  if (!isJwk(body?.pubkey) || !ecdhPubOk) {
    return NextResponse.json({ error: "invalid-member" }, { status: 400 });
  }

  const room = await db.room.findUnique({ where: { id: roomId } });
  if (!room || room.burned) {
    return NextResponse.json({ error: "not-found", burned: !!room?.burned }, { status: 404 });
  }
  if (roomExpired(room.expiresAt)) {
    return NextResponse.json({ error: "room-expired" }, { status: 404 });
  }

  // The join proof: a password holder, not a link holder. Rooms
  // sealed before the proof existed have no verifier stored, and the
  // server cannot invent one, so they keep the old rule.
  if (room.joinProof) {
    const joinOk = await verifyJoinProof(
      room.joinProof,
      typeof body.joinProof === "string" ? body.joinProof : null,
      roomId,
    );
    if (!joinOk) {
      return NextResponse.json({ error: "join-proof-required" }, { status: 403 });
    }
  }

  // The alias and the ink are DERIVED here, from the public key, and
  // whatever the client sent is ignored. They were client-supplied
  // before, so a member could wear another member's name. See
  // bugs/BUGS.md B9.
  const pubJwk = body.pubkey as JsonWebKey;
  const fingerprintHex = await sha256Hex(`${pubJwk.x}|${pubJwk.y}`);
  const alias = aliasFromFingerprint(fingerprintHex);
  const colorIdx = inkFromFingerprint(fingerprintHex);

  const pubkey = JSON.stringify(body.pubkey);
  if (pubkey.length > PUBKEY_JSON_MAX) {
    return NextResponse.json({ error: "invalid-member" }, { status: 400 });
  }
  const existing = await db.member.findUnique({
    where: { roomId_pubkey: { roomId, pubkey } },
  });

  if (existing) {
    // The update path. It writes a row that already exists, so it
    // proves possession of the registered key first.
    //
    // The proof covers the ECDH key being written, so a captured
    // proof cannot be replayed onto somebody else's ECDH key. The
    // ECDH key is mandatory here: the client regenerates one per page
    // load, and the proof has to name what is being written.
    if (typeof body.ecdhPub !== "string" || body.ecdhPub.length === 0) {
      return NextResponse.json({ error: "proof-required" }, { status: 403 });
    }
    const proof = body.proof;
    let registeredPub: unknown = null;
    try {
      registeredPub = JSON.parse(existing.pubkey);
    } catch {
      registeredPub = null;
    }
    const proofOk =
      !!proof &&
      typeof proof.ts === "number" &&
      Number.isFinite(proof.ts) &&
      typeof proof.sig === "string" &&
      proof.sig.length > 0 &&
      proof.sig.length <= 512 &&
      (await verifyMemberProof(
        registeredPub,
        proof.sig,
        roomId,
        body.ecdhPub,
        proof.ts,
      ));
    if (!proofOk) {
      return NextResponse.json({ error: "proof-required" }, { status: 403 });
    }

    // Same clamp on re-join as on first join (the update path once
    // wrote colorIdx raw while create clamped it — an inconsistency
    // that let a hostile client push out-of-range ink indices). The
    // alias and the ink are the derived ones, not the client's.
    const member = await db.member.update({
      where: { id: existing.id },
      data: {
        active: true,
        lastSeenAt: new Date(),
        alias,
        colorIdx: Math.max(0, Math.min(7, colorIdx)),
        ecdhPub: body.ecdhPub,
      },
    });
    return NextResponse.json({
      memberId: member.id,
      epoch: room.epoch,
      rejoined: true,
    });
  }

  // Cap trade-off, stated honestly: the cap is a freshness-windowed
  // SOFT cap. It counts only active members seen within
  // MEMBER_FRESH_WINDOW_MS, so it exists to stop a code-holder without
  // the password from permanently locking the room with throwaway
  // keys. A coordinated attacker with many IPs and keys can still
  // exceed it (presence noise, not a confidentiality issue, matching
  // the Task 19 acceptance review's assessment).
  const recentlySeenCount = await db.member.count({
    where: {
      roomId,
      active: true,
      lastSeenAt: { gte: new Date(Date.now() - MEMBER_FRESH_WINDOW_MS) },
    },
  });
  const decision = decideAdmission({ recentlySeenCount });
  if (decision === "full") {
    return NextResponse.json({ error: "room-full" }, { status: 403 });
  }

  const member = await db.member.create({
    data: {
      roomId,
      pubkey,
      ...(typeof body.ecdhPub === "string" ? { ecdhPub: body.ecdhPub } : {}),
      alias,
      colorIdx: Math.max(0, Math.min(7, colorIdx)),
      active: true,
    },
  });
  return NextResponse.json({ memberId: member.id, epoch: room.epoch, rejoined: false }, { status: 201 });
}

// GET /api/rooms/:roomId/members. The registry used by the key
// verification panel and by the key-offer path. Public keys only; the
// server cannot forge them.
//
// The roster is behind the join proof when the room has one. It used
// to be world-readable: anybody with the link could read every
// member's public key, their alias and their ECDH key. The proof is
// what a password holder can make, so the roster now answers only to
// somebody who knows the password. Rooms sealed before the proof
// existed have no verifier stored and keep the old rule. See
// bugs/BUGS.md B8.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await params;
  const room = await db.room.findUnique({ where: { id: roomId } });
  if (!room || room.burned || roomExpired(room.expiresAt)) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
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
  const members = await db.member.findMany({
    where: { roomId, active: true },
    orderBy: { joinedAt: "asc" },
  });
  return NextResponse.json({
    members: members.map((m) => ({
      memberId: m.id,
      alias: m.alias,
      colorIdx: m.colorIdx,
      pubkey: JSON.parse(m.pubkey),
      ecdhPub: m.ecdhPub ?? undefined,
      joinedAt: m.joinedAt,
    })),
  });
}
