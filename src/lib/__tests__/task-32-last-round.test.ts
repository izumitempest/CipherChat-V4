// Task 32: THE LAST IN-SANDBOX ROUND
//
// This file used to hold three properties. It holds one now.
//
//   1. THE CANONICAL. The v2 signing string joined variable-length
//      fields with a pipe and escaped only one of them, so two
//      different bodies could produce the same string. A signed plain
//      letter could be re-encrypted as a quote its author never
//      wrote. Protocol v3 signs the whole body instead, and the tests
//      below say what that buys.
//
//   2. The report proof (cc-report-v1) and the anonymous corroboration
//      tally went with the abuse report feature. The room ends when
//      its time runs out or when the creator burns it. There is no
//      report button and no report endpoint. The leave proof keeps
//      its own suite in task-22.1-leave-proof.test.ts.

import { describe, it, expect } from "vitest";
import {
  canonicalV2,
  canonicalV3FromBody,
  type ReplySnapshot,
} from "@/lib/protocol";

/* ------------------------------------------------------------------ *
 * 1. Canonical separator collision
 * ------------------------------------------------------------------ */

const BASE = {
  roomId: "RM4GUEST",
  kv: 2,
  senderId: "member-one",
  sessionTag: "tag-abc",
  counter: 7,
  ts: 1_700_000_123_456,
  kind: "chat",
};

const R1: ReplySnapshot = { id: "r1", senderId: "s1", snippet: "hi there", file: true };
const R2: ReplySnapshot = {
  id: "x|y",
  senderId: "s2",
  snippet: "pipes | percents % units \u001f and more | | |",
  file: false,
};

describe("canonical: v3 signs the whole body, so no two bodies share a canonical", () => {
  it("the exact old collision pair produces DIFFERENT canonicals", async () => {
    // v2 built "...|text|hello|world||" for BOTH of these, so a
    // signature over one verified for the other. v3 hashes the body,
    // and these are different bodies.
    const a = await canonicalV3FromBody(BASE.roomId, {
      ...BASE,
      sig: "",
      kind: "text",
      text: "hello|world",
      fileSha: "",
    });
    const b = await canonicalV3FromBody(BASE.roomId, {
      ...BASE,
      sig: "",
      kind: "text",
      text: "hello",
      fileSha: "world|",
    });
    expect(a).not.toBe(b);
  });

  it("the v2 canonical still collides, which is why v2 frames are refused", () => {
    // The old signing string is kept in the tree on purpose, so this
    // test can say why the protocol split happened. If it ever stops
    // colliding, the history here is wrong.
    const a = canonicalV2({ ...BASE, kind: "text", text: "hello|world", fileSha: "" });
    const b = canonicalV2({ ...BASE, kind: "text", text: "hello", fileSha: "world|" });
    expect(a).toBe(b);
  });

  it("no two distinct bodies share a canonical (adversarial battery)", async () => {
    const bodies: Record<string, unknown>[] = [];
    const texts = ["", "abc", "abc|", "|", "|||", "a|b|c", "a\u001fb", "%7C", "100%", "😀"];
    for (const text of texts) {
      bodies.push({ ...BASE, sig: "", kind: "text", text });
    }
    // The same words split differently across two fields: that was
    // the collision. Both splits are in the battery.
    bodies.push({ ...BASE, sig: "", kind: "text", text: "hello|world", fileSha: "" });
    bodies.push({ ...BASE, sig: "", kind: "text", text: "hello", fileSha: "world|" });
    // A reply that carries a separator inside the snippet.
    bodies.push({
      ...BASE,
      sig: "",
      kind: "text",
      text: "x",
      reply: { id: "r1", senderId: "s1", snippet: "a|b", file: false },
    });
    bodies.push({
      ...BASE,
      sig: "",
      kind: "text",
      text: "x",
      reply: { id: "r1", senderId: "s1", snippet: "a", file: false },
    });

    const canonicals = await Promise.all(
      bodies.map((b) => canonicalV3FromBody(BASE.roomId, b)),
    );
    expect(new Set(canonicals).size).toBe(bodies.length);
  });

  it("the canonical is length-prefixed, so it cannot be split", async () => {
    const c = await canonicalV3FromBody("ROOMX1", { ...BASE, sig: "", kind: "text" });
    expect(c.startsWith("2:v36:ROOMX1")).toBe(true);
    // then the body hash: 64 hex characters behind its own byte count
    expect(c.slice("2:v36:ROOMX1".length).startsWith("64:")).toBe(true);
    // the old separator is nowhere in it
    expect(c).not.toContain("|");
    // a room id with an emoji counts BYTES, not code units
    const emoji = await canonicalV3FromBody("R😀", { ...BASE, sig: "", kind: "text" });
    expect(emoji.startsWith("2:v35:R😀")).toBe(true);
  });
});


