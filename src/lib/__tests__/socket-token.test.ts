import { describe, expect, it } from "vitest";
import { makeSocketToken, SOCKET_TOKEN_TTL_MS, verifySocketToken } from "@/lib/socket-token";

const SECRET = "test-secret-key";

describe("socket token", () => {
  it("creates and verifies a valid token", async () => {
    const token = await makeSocketToken(SECRET, "ROOM1", "member-abc");
    const payload = await verifySocketToken(SECRET, token);
    expect(payload).toEqual({ roomId: "ROOM1", memberId: "member-abc" });
  });

  it("rejects a token with wrong secret", async () => {
    const token = await makeSocketToken(SECRET, "ROOM1", "member-abc");
    const payload = await verifySocketToken("wrong-secret", token);
    expect(payload).toBeNull();
  });

  it("rejects a tampered token", async () => {
    const token = await makeSocketToken(SECRET, "ROOM1", "member-abc");
    const tampered = token.slice(0, -5) + "XXXXX";
    const payload = await verifySocketToken(SECRET, tampered);
    expect(payload).toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await makeSocketToken(SECRET, "ROOM1", "member-abc", 1);
    await new Promise((r) => setTimeout(r, 10));
    const payload = await verifySocketToken(SECRET, token);
    expect(payload).toBeNull();
  });

  it("rejects a malformed token", async () => {
    expect(await verifySocketToken(SECRET, "not-a-token")).toBeNull();
    expect(await verifySocketToken(SECRET, "a.b")).toBeNull();
    expect(await verifySocketToken(SECRET, "")).toBeNull();
  });

  it("token TTL default is 5 minutes", () => {
    expect(SOCKET_TOKEN_TTL_MS).toBe(5 * 60_000);
  });

  it("accepts a token valid at the boundary", async () => {
    const token = await makeSocketToken(SECRET, "ROOM1", "member-abc", 10_000);
    const payload = await verifySocketToken(SECRET, token, Date.now() + 5_000);
    expect(payload).toEqual({ roomId: "ROOM1", memberId: "member-abc" });
  });
});
