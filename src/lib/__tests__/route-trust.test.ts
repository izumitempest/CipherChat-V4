// THE ROUTES, AT THE TRUST BOUNDARY
//
// The protocol primitives are tested elsewhere. This file is about the
// places where trust changes hands: the API routes.
//
// Every test here runs against a real SQLite database, a throwaway one
// in the temp folder, created by the migrations. The routes are called
// the way Next calls them: a Request in, a Response out.
//
// Covered:
//   - a new member with no password proof is refused (B7)
//   - a join with a good proof lands, and the alias is the server's
//     derivation, not the client's word (B9)
//   - an existing member whose key does not match is refused without a
//     proof of possession (B6)
//   - a body over the cap is refused (B14)
//   - a burn with the wrong creator token does not burn (B20)
//   - the roster is behind the join proof (B8)
//
// See bugs/BUGS.md B45.

import { beforeEach, describe, expect, it, vi } from "vitest";

// The database has to exist, and the environment has to point at it,
// before the route modules import the Prisma client. vi.hoisted runs
// first, and it cannot use the imports above (they are hoisted after
// it), so the built-ins come from process.getBuiltinModule.
const testDb = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs");
  const os = process.getBuiltinModule("node:os");
  const path = process.getBuiltinModule("node:path");
  const { execFileSync } = process.getBuiltinModule("node:child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-route-test-"));
  const file = path.join(dir, "routes.db");
  process.env.DATABASE_URL = `file:${file}`;
  // The Prisma CLI, through the running runtime (bun in CI, node
  // locally). bunx is a shell script, so it cannot be spawned
  // directly.
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    { cwd: process.cwd(), stdio: "ignore" },
  );
  return { dir, file };
});

import { db } from "@/lib/db";
import { POST as membersPost, GET as membersGet } from "@/app/api/rooms/[roomId]/members/route";
import { POST as burnPost } from "@/app/api/rooms/[roomId]/burn/route";
import { encodeJoinProof, makeJoinProof } from "@/lib/join-proof";
import { signMemberProof } from "@/lib/member-proof";
import { aliasFromFingerprint, inkFromFingerprint, sha256Hex } from "@/lib/identity";
import { hashCreatorToken } from "@/lib/creator-token";

const ROOM = "TESTROOM1";
const JOIN_VERIFIER = Buffer.from("join-verifier-for-the-test-room").toString("base64");

async function newKeyPair() {
  const sig = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const privJwk = await crypto.subtle.exportKey("jwk", sig.privateKey);
  const pubJwk = await crypto.subtle.exportKey("jwk", sig.publicKey);
  return { privJwk, pubJwk };
}

function jwkJson(jwk: JsonWebKey) {
  return JSON.stringify(jwk);
}

/** The room, with a join verifier stored (as a sealed room has). */
async function makeRoom() {
  await db.room.create({
    data: {
      id: ROOM,
      verifier: JSON.stringify({ v: 2, alg: "argon2id", salt: "x", m: 65536, t: 3, p: 1 }),
      joinProof: JOIN_VERIFIER,
      creatorToken: await hashCreatorToken("creator-token-value"),
      epoch: 1,
    },
  });
}

function memberRequest(body: unknown): Request {
  return new Request(`http://localhost/api/rooms/${ROOM}/members`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function joinBody(pubJwk: JsonWebKey, ecdhPub: string) {
  const proof = await makeJoinProof(JOIN_VERIFIER, ROOM);
  return {
    pubkey: pubJwk,
    ecdhPub,
    alias: "Impostor",
    colorIdx: 7,
    joinProof: encodeJoinProof(proof),
  };
}

beforeEach(async () => {
  await db.member.deleteMany({ where: { roomId: ROOM } });
  await db.room.deleteMany({ where: { id: ROOM } });
  await makeRoom();
});

describe("the member join route", () => {
  it("refuses a join with no password proof", async () => {
    const { pubJwk } = await newKeyPair();
    const res = await membersPost(
      memberRequest({ pubkey: pubJwk, ecdhPub: "AAAA" }),
      { params: Promise.resolve({ roomId: ROOM }) },
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("join-proof-required");
    expect(await db.member.count({ where: { roomId: ROOM } })).toBe(0);
  });

  it("refuses a join whose proof was made for another room", async () => {
    const { pubJwk } = await newKeyPair();
    const proof = await makeJoinProof(JOIN_VERIFIER, "OTHERROOM");
    const res = await membersPost(
      memberRequest({ pubkey: pubJwk, ecdhPub: "AAAA", joinProof: encodeJoinProof(proof) }),
      { params: Promise.resolve({ roomId: ROOM }) },
    );
    expect(res.status).toBe(403);
    expect(await db.member.count({ where: { roomId: ROOM } })).toBe(0);
  });

  it("accepts a join with a good proof, and stores the derived alias and ink", async () => {
    const { pubJwk } = await newKeyPair();
    const body = await joinBody(pubJwk, "AAAA");
    const res = await membersPost(memberRequest(body), {
      params: Promise.resolve({ roomId: ROOM }),
    });
    expect(res.status).toBe(201);

    const member = await db.member.findFirst({ where: { roomId: ROOM } });
    expect(member).not.toBeNull();
    // The alias is derived from the key, so it is not the word the
    // client sent.
    const hex = await sha256Hex(`${pubJwk.x}|${pubJwk.y}`);
    expect(member!.alias).toBe(aliasFromFingerprint(hex));
    expect(member!.alias).not.toBe("Impostor");
    expect(member!.colorIdx).toBe(inkFromFingerprint(hex));
  });

  it("refuses an ecdh key change with no proof of possession", async () => {
    const { pubJwk } = await newKeyPair();
    // The first join registers this key.
    const first = await membersPost(memberRequest(await joinBody(pubJwk, "AAAA")), {
      params: Promise.resolve({ roomId: ROOM }),
    });
    expect(first.status).toBe(201);

    // The same signing key comes back with a different session ECDH
    // key and no proof. That is the hijack the proof closes: anybody
    // who learned the public key could otherwise take the member's
    // seat and receive the key offers.
    const res = await membersPost(memberRequest(await joinBody(pubJwk, "BBBB")), {
      params: Promise.resolve({ roomId: ROOM }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("proof-required");
    const member = await db.member.findFirst({ where: { roomId: ROOM } });
    expect(member!.ecdhPub).toBe("AAAA");
  });

  it("accepts the same key again with its proof, and refreshes the row", async () => {
    const { privJwk, pubJwk } = await newKeyPair();
    await membersPost(memberRequest(await joinBody(pubJwk, "AAAA")), {
      params: Promise.resolve({ roomId: ROOM }),
    });
    const memberProof = await signMemberProof(privJwk, ROOM, "CCCC");
    const body = await joinBody(pubJwk, "CCCC");
    const res = await membersPost(
      memberRequest({ ...body, proof: memberProof }),
      { params: Promise.resolve({ roomId: ROOM }) },
    );
    expect(res.status).toBe(200);
    const member = await db.member.findFirst({ where: { roomId: ROOM } });
    expect(member!.ecdhPub).toBe("CCCC");
  });

  it("refuses a body over the cap", async () => {
    const { pubJwk } = await newKeyPair();
    const big = "x".repeat(70 * 1024);
    const res = await membersPost(
      memberRequest({ pubkey: pubJwk, ecdhPub: "AAAA", joinProof: big }),
      { params: Promise.resolve({ roomId: ROOM }) },
    );
    expect(res.status).toBe(413);
  });
});

describe("the roster route", () => {
  it("refuses a read with no proof, and answers with one", async () => {
    const { pubJwk } = await newKeyPair();
    await membersPost(memberRequest(await joinBody(pubJwk, "AAAA")), {
      params: Promise.resolve({ roomId: ROOM }),
    });

    const noProof = await membersGet(new Request(`http://localhost/api/rooms/${ROOM}/members`), {
      params: Promise.resolve({ roomId: ROOM }),
    });
    expect(noProof.status).toBe(403);
    expect((await noProof.json()).error).toBe("join-proof-required");

    const proof = await makeJoinProof(JOIN_VERIFIER, ROOM);
    const withProof = await membersGet(
      new Request(`http://localhost/api/rooms/${ROOM}/members`, {
        headers: { "x-join-proof": encodeJoinProof(proof) },
      }),
      { params: Promise.resolve({ roomId: ROOM }) },
    );
    expect(withProof.status).toBe(200);
    const body = (await withProof.json()) as { members: unknown[] };
    expect(body.members.length).toBe(1);
  });
});

describe("the burn route", () => {
  it("refuses a burn with the wrong creator token", async () => {
    const res = await burnPost(
      new Request(`http://localhost/api/rooms/${ROOM}/burn`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ creatorToken: "not-the-token" }),
      }),
      { params: Promise.resolve({ roomId: ROOM }) },
    );
    expect(res.status).toBe(403);
    const room = await db.room.findUnique({ where: { id: ROOM } });
    expect(room!.burned).toBe(false);
  });

  it("burns with the right creator token", async () => {
    const res = await burnPost(
      new Request(`http://localhost/api/rooms/${ROOM}/burn`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ creatorToken: "creator-token-value" }),
      }),
      { params: Promise.resolve({ roomId: ROOM }) },
    );
    expect(res.status).toBe(200);
    const room = await db.room.findUnique({ where: { id: ROOM } });
    expect(room!.burned).toBe(true);
  });
});
