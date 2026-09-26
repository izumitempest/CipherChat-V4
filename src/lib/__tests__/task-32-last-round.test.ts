// Task 32: THE LAST IN-SANDBOX ROUND
//
// Three properties, one file:
//
//   1. CANONICAL SEPARATOR COLLISION (the Task 31 acceptance review's
//      confirm #5): the conditional 12th canonical slot must be
//      collision-proof against field 11's content: a crafted
//      messageId that terminates with (or embeds) the separator must
//      never be able to counterfeit a reply slot. Before the fix, a
//      plain frame with messageId "abc|<replyCanonical>" produced the
//      SAME string as the reply frame {messageId:"abc", reply}: a
//      signed plain letter could be re-encrypted as a quote its author
//      never wrote. escapeCanonicalField makes field 11 separator-free,
//      which makes the boundary injective (proof below, in the tests).
//
//   2. REPORT PROOF-OF-POSSESSION (cc-report-v1): the graded abuse
//      report's member half, mirroring the leave-proof suite, and
//      domain-separated from it, so neither proof replays as the other.
//
//   3. ANONYMOUS CORROBORATION TALLY: one IP is noise, three distinct
//      networks are evidence, a day-old gripe is stale.

import { describe, it, expect } from "vitest";
import {
  canonicalV2,
  replyCanonical,
  escapeCanonicalField,
  type ReplySnapshot,
} from "@/lib/protocol";
import {
  REPORT_PROOF_TOLERANCE_MS,
  REPORT_TALLY_WINDOW_MS,
  ANONYMOUS_REPORT_IP_THRESHOLD,
  reportProofInput,
  signReportProof,
  verifyReportProof,
  tallyAnonymousReport,
} from "@/lib/report-proof";
import { signLeaveProof, verifyLeaveProof } from "@/lib/leave-proof";

async function makeKey(): Promise<{ privJwk: JsonWebKey; pubJwk: JsonWebKey }> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  return {
    privJwk: await crypto.subtle.exportKey("jwk", pair.privateKey),
    pubJwk: await crypto.subtle.exportKey("jwk", pair.publicKey),
  };
}

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

describe("canonical: the conditional 12th slot is collision-proof against field 11", () => {
  it("the exact pre-fix collision pair now produces DIFFERENT strings", () => {
    const slot = replyCanonical(R1);
    // Pre-fix, these two were byte-identical: the forged-quote
    // primitive. The escape breaks the equivalence.
    const plainCrafted = canonicalV2({ ...BASE, messageId: `abc|${slot}` });
    const replyFrame = canonicalV2({ ...BASE, messageId: "abc", reply: R1 });
    expect(plainCrafted).not.toBe(replyFrame);
    // ...and it breaks it by escaping the pipe, visibly.
    expect(plainCrafted).toContain("%7C");
    expect(replyFrame).not.toContain("%7C");
  });

  it("a messageId that TERMINATES with the separator counterfeits nothing", () => {
    // "...|abc|" must not equal any reply-carrying canonical built from
    // id "abc": the review's named case.
    const trailing = canonicalV2({ ...BASE, messageId: "abc|" });
    for (const r of [undefined, R1, R2]) {
      expect(trailing).not.toBe(canonicalV2({ ...BASE, messageId: "abc", reply: r }));
    }
    expect(trailing).not.toMatch(/\|$/); // no raw trailing separator survives...
    expect(trailing.endsWith("%7C")).toBe(true); // ...only the escaped form does
  });

  it("the structural lemma: escaped field 11 never contains the separator", () => {
    // This is the injectivity core. If field 11 cannot contain "|",
    // then no plain frame's tail can equal `messageId + "|" + slot`
    // (the right-hand side always contains the joiner), and two
    // reply-carrying canonicals can only differ-or-match on their
    // first pipe's position, which pins field 11.
    const adversarial = [
      "",
      "abc",
      "abc|",
      "|",
      "|||",
      "a|b|c|d|e|f",
      `abc|${replyCanonical(R1)}`,
      `abc|${replyCanonical(R2)}`,
      "abc%7C",
      "abc%25",
      "abc%257C",
      "abc\u001fdef",
      "abc%1f",
      "%|%u001f|%",
    ];
    for (const s of adversarial) {
      expect(escapeCanonicalField(s)).not.toContain("|");
      expect(escapeCanonicalField(s)).not.toContain("\u001f");
    }
  });

  it("the escape is injective on the adversarial battery (distinct ids → distinct canonicals)", () => {
    const ids = [
      "abc",
      "abc|",
      "abc|||",
      `abc|${replyCanonical(R1)}`,
      `abc|${replyCanonical(R2)}`,
      "abc%7C", // a LITERAL percent sequence must not collide with an escaped pipe
      "abc%25", // nor with an escaped percent
      "abc%257C",
      "abc\u001f",
      "x|y|z",
    ];
    const seen = new Map<string, string>();
    for (const id of ids) {
      const esc = escapeCanonicalField(id);
      expect(seen.has(esc)).toBe(false);
      seen.set(esc, id);
    }
  });

  it("full injectivity over the (messageId, reply) battery — no two distinct frames share a canonical", () => {
    const ids = ["abc", "abc|", `abc|${replyCanonical(R1)}`, "abc%7C", "abc\u001f", ""];
    const replies: (ReplySnapshot | undefined)[] = [undefined, R1, R2];
    const canonicals: string[] = [];
    const labels: string[] = [];
    for (const id of ids) {
      for (const reply of replies) {
        canonicals.push(canonicalV2({ ...BASE, messageId: id, reply }));
        labels.push(`id=${JSON.stringify(id)} reply=${reply ? "yes" : "no"}`);
      }
    }
    const unique = new Set(canonicals);
    expect(unique.size).toBe(canonicals.length); // 18 distinct frames → 18 distinct canonicals
  });

  it("legacy byte-compat: clean messageIds canonicalise EXACTLY as before the escape", () => {
    // Real messageIds are crypto.randomUUID()s (and key:offer ids are
    // "offer:{cuid}:{epoch}", cuid = [a-z0-9]): the escape is a no-op
    // for every frame any shipped client ever produced, so the
    // Round-31 cross-version proofs survive byte-for-byte.
    const uuid = "0f8d3c61-9a52-4b7e-a8d1-3c2b1f9e7a44";
    const offerId = "offer:ck8x2p1qw9e3r:2";
    const eleven = (mid: string) =>
      ["v2", BASE.roomId, BASE.kv, BASE.senderId, BASE.sessionTag, BASE.counter, BASE.ts, BASE.kind, "hello", "", mid].join("|");

    expect(canonicalV2({ ...BASE, text: "hello", messageId: uuid })).toBe(eleven(uuid));
    expect(canonicalV2({ ...BASE, text: "hello", messageId: offerId })).toBe(eleven(offerId));
    expect(canonicalV2({ ...BASE, text: "hello", messageId: uuid, reply: R1 })).toBe(
      `${eleven(uuid)}|${replyCanonical(R1)}`,
    );
  });
});

/* ------------------------------------------------------------------ *
 * 2. Report proof-of-possession (cc-report-v1)
 * ------------------------------------------------------------------ */

describe("report proof-of-possession", () => {
  it("signs and verifies the exact canonical string", async () => {
    expect(reportProofInput("ROOM", "MEM", 123)).toBe("cc-report-v1:ROOM:MEM:123");
    const k = await makeKey();
    const proof = await signReportProof(k.privJwk, "ROOM", "MEM", 123);
    expect(proof.ts).toBe(123);
    expect(proof.sig).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(await verifyReportProof(k.pubJwk, proof.sig, "ROOM", "MEM", 123, 123)).toBe(true);
  });

  it("a signature by a DIFFERENT key does not verify", async () => {
    const a = await makeKey();
    const b = await makeKey();
    const proof = await signReportProof(b.privJwk, "ROOM", "MEM", 1000);
    expect(await verifyReportProof(a.pubJwk, proof.sig, "ROOM", "MEM", 1000, 1000)).toBe(false);
  });

  it("a tampered canonical field (verifying for another memberId) does not verify", async () => {
    const k = await makeKey();
    const proof = await signReportProof(k.privJwk, "ROOM", "VICTIM", 1000);
    expect(await verifyReportProof(k.pubJwk, proof.sig, "ROOM", "IMPOSTOR", 1000, 1000)).toBe(
      false,
    );
  });

  it("a stale timestamp (11 minutes old) does not verify — the replayed-signature refusal", async () => {
    const k = await makeKey();
    const now = 1_700_000_000_000;
    const proof = await signReportProof(k.privJwk, "ROOM", "MEM", now - 11 * 60_000);
    expect(await verifyReportProof(k.pubJwk, proof.sig, "ROOM", "MEM", proof.ts, now)).toBe(false);
  });

  it("a proof from the future (11 minutes ahead) does not verify", async () => {
    const k = await makeKey();
    const now = 1_700_000_000_000;
    const proof = await signReportProof(k.privJwk, "ROOM", "MEM", now + 11 * 60_000);
    expect(await verifyReportProof(k.pubJwk, proof.sig, "ROOM", "MEM", proof.ts, now)).toBe(false);
  });

  it("a proof exactly at the ±10-minute boundary still verifies", async () => {
    const k = await makeKey();
    const now = 1_700_000_000_000;
    const old = await signReportProof(k.privJwk, "ROOM", "MEM", now - REPORT_PROOF_TOLERANCE_MS);
    expect(await verifyReportProof(k.pubJwk, old.sig, "ROOM", "MEM", old.ts, now)).toBe(true);
    const future = await signReportProof(k.privJwk, "ROOM", "MEM", now + REPORT_PROOF_TOLERANCE_MS);
    expect(await verifyReportProof(k.pubJwk, future.sig, "ROOM", "MEM", future.ts, now)).toBe(true);
  });

  it("malformed base64 and non-JWK pubkeys fail without throwing", async () => {
    const k = await makeKey();
    const proof = await signReportProof(k.privJwk, "ROOM", "MEM", 1000);
    expect(
      await verifyReportProof(k.pubJwk, "not!!valid@@base64", "ROOM", "MEM", 1000, 1000),
    ).toBe(false);
    expect(await verifyReportProof({ nope: true }, proof.sig, "ROOM", "MEM", 1000, 1000)).toBe(
      false,
    );
    expect(await verifyReportProof(null, proof.sig, "ROOM", "MEM", 1000, 1000)).toBe(false);
  });

  it("domain separation: a LEAVE proof never verifies as a REPORT proof, and vice versa", async () => {
    // Same key, same room, same member, same ts: only the domain
    // prefix differs. A captured departure proof must not burn the
    // room; a captured report proof must not write anyone out.
    const k = await makeKey();
    const leave = await signLeaveProof(k.privJwk, "ROOM", "MEM", 1000);
    const report = await signReportProof(k.privJwk, "ROOM", "MEM", 1000);
    expect(await verifyReportProof(k.pubJwk, leave.sig, "ROOM", "MEM", 1000, 1000)).toBe(false);
    expect(await verifyLeaveProof(k.pubJwk, report.sig, "ROOM", "MEM", 1000, 1000)).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * 3. Anonymous corroboration tally
 * ------------------------------------------------------------------ */

describe("anonymous report tally", () => {
  it("a single anonymous report does NOT burn", () => {
    const { next, burn } = tallyAnonymousReport(null, "1.1.1.1", 1000);
    expect(burn).toBe(false);
    expect(next.ips.size).toBe(1);
  });

  it("the same IP repeating never adds weight", () => {
    let state = tallyAnonymousReport(null, "1.1.1.1", 1000).next;
    for (let i = 0; i < 20; i++) {
      const r = tallyAnonymousReport(state, "1.1.1.1", 1000 + i);
      state = r.next;
      expect(r.burn).toBe(false);
    }
    expect(state.ips.size).toBe(1);
  });

  it("three DISTINCT IPs burn — and not before", () => {
    const a = tallyAnonymousReport(null, "1.1.1.1", 1000);
    expect(a.burn).toBe(false);
    const b = tallyAnonymousReport(a.next, "2.2.2.2", 2000);
    expect(b.burn).toBe(false);
    const c = tallyAnonymousReport(b.next, "3.3.3.3", 3000);
    expect(c.burn).toBe(true);
    expect(c.next.ips.size).toBe(ANONYMOUS_REPORT_IP_THRESHOLD);
  });

  it("a day-old tally resets — stale grievances are not corroboration", () => {
    const fresh = tallyAnonymousReport(null, "1.1.1.1", 1000).next;
    const later = tallyAnonymousReport(fresh, "2.2.2.2", 2000).next;
    expect(later.ips.size).toBe(2);
    // 25 hours after the tally began: reset, then this report is a
    // fresh single (not a third).
    const stale = tallyAnonymousReport(later, "3.3.3.3", 1000 + REPORT_TALLY_WINDOW_MS + 60_000);
    expect(stale.burn).toBe(false);
    expect(stale.next.ips.size).toBe(1);
    expect(stale.next.firstAt).toBe(1000 + REPORT_TALLY_WINDOW_MS + 60_000);
  });

  it("exactly at the window boundary the tally is still live (strict reset)", () => {
    const fresh = tallyAnonymousReport(null, "1.1.1.1", 1000).next;
    const later = tallyAnonymousReport(fresh, "2.2.2.2", 2000).next;
    const atBoundary = tallyAnonymousReport(
      later,
      "3.3.3.3",
      1000 + REPORT_TALLY_WINDOW_MS,
    );
    expect(atBoundary.burn).toBe(true); // exactly 24h: still the same tally
  });
});
