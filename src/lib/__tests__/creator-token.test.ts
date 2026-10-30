// THE CREATOR TOKEN
//
// Property: the token that authorizes burning a room and changing its
// lifetime never sits in the database in the clear, and a wrong token
// does not compare equal, whatever it looks like.
//
// The server stores sha256 of the token, domain separated, and compares
// in constant time. Rooms sealed before the change stored the token
// plain; the plain one still works (so old rooms keep burning) and the
// server upgrades it to the hash on first use.
//
// See bugs/BUGS.md B20.

import { describe, it, expect } from "vitest";
import {
  creatorTokenMatches,
  hashCreatorToken,
  isPlainCreatorToken,
} from "@/lib/creator-token";

const TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef";

describe("the creator token", () => {
  it("the stored form is not the token", async () => {
    const hash = await hashCreatorToken(TOKEN);
    expect(hash).not.toBe(TOKEN);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the hash is stable, so the same token always reads the same row", async () => {
    expect(await hashCreatorToken(TOKEN)).toBe(await hashCreatorToken(TOKEN));
  });

  it("the hash is domain separated", async () => {
    // The same string hashed without the prefix must not collide with
    // the stored form.
    const raw = await import("@/lib/identity");
    expect(await hashCreatorToken(TOKEN)).not.toBe(await raw.sha256Hex(TOKEN));
  });

  it("the right token matches the stored hash", async () => {
    const hash = await hashCreatorToken(TOKEN);
    expect(await creatorTokenMatches(hash, TOKEN)).toBe(true);
  });

  it("the wrong token does not match", async () => {
    const hash = await hashCreatorToken(TOKEN);
    expect(await creatorTokenMatches(hash, "f".repeat(48))).toBe(false);
    expect(await creatorTokenMatches(hash, "")).toBe(false);
    expect(await creatorTokenMatches(hash, undefined)).toBe(false);
    expect(await creatorTokenMatches(null, TOKEN)).toBe(false);
  });

  it("a token that shares a prefix with the hash does not match", async () => {
    const hash = await hashCreatorToken(TOKEN);
    // A prefix of the hash is not the token.
    expect(await creatorTokenMatches(hash, hash.slice(0, 48))).toBe(false);
  });

  it("a plain token from an older room still matches", async () => {
    expect(await creatorTokenMatches(TOKEN, TOKEN)).toBe(true);
    expect(await creatorTokenMatches(TOKEN, "0".repeat(48))).toBe(false);
  });

  it("the plain-token check tells the two stored forms apart", async () => {
    expect(isPlainCreatorToken(TOKEN)).toBe(true);
    expect(isPlainCreatorToken(await hashCreatorToken(TOKEN))).toBe(false);
    expect(isPlainCreatorToken(null)).toBe(false);
    // A stored value that is 64 hex characters but not the hash of the
    // token is treated as a plain token, which is the safe direction:
    // the plain comparison still has to succeed for it to be used.
    expect(isPlainCreatorToken("a".repeat(64))).toBe(false);
  });
});
