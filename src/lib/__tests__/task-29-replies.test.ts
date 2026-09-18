// Task 29 — REPLIES AND IN-APP VIEWING
//
// Property: a quoted reply is exactly as authentic as the words it
// carries. The reply snapshot rides the encrypted frame body AND the
// canonical signature string, so nobody can make a message appear to
// quote words their author never wrote. The viewer helpers (CSV
// parsing, classification, snippet sanitising) are the same pure
// functions the UI runs — tested here at the boundary.

import { describe, it, expect } from "vitest";
import { CONTROL_FRAME_BYTES, fromB64, replyCanonical } from "@/lib/protocol";
import { makeRoom, broadcast, randomAesKey } from "./helpers";
import {
  makeReplySnapshot,
  sanitizeReplySnapshot,
  REPLY_SNIPPET_MAX,
  type MessageView,
} from "@/lib/types";
import { classifyFile, parseCsv } from "@/components/cc/file-viewer";

const SNAP = { id: "msg-1", senderId: "m-b", snippet: "the words being answered" };

describe("quoted replies on the wire", () => {
  it("a reply round-trips: text arrives with its quote intact", async () => {
    const [alice, bob] = await makeRoom("REPL1", ["m-a", "m-b"], await randomAesKey());
    const frames = await alice.cipher.sealText({
      text: "here is my answer",
      reply: { ...SNAP, senderId: "m-b" },
    });
    const results = await broadcast(frames, [alice, bob], alice.id);
    const text = results.find((r) => r.type === "text");
    expect(text).toBeDefined();
    if (text && text.type === "text") {
      expect(text.body.text).toBe("here is my answer");
      expect(text.body.reply).toEqual({ ...SNAP, senderId: "m-b" });
    }
  });

  it("a file reply carries its quote through assembly to completion", async () => {
    const [alice, bob] = await makeRoom("REPL2", ["m-a", "m-b"], await randomAesKey());
    const bytes = new Uint8Array(1024).fill(7);
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    const dataB64 = btoa(s);
    const sha = await crypto.subtle
      .digest("SHA-256", bytes)
      .then((h) =>
        Array.from(new Uint8Array(h), (x) => x.toString(16).padStart(2, "0")).join(""),
      );
    const frames = await alice.cipher.sealFile({
      name: "notes.bin",
      mime: "application/octet-stream",
      size: bytes.length,
      dataB64,
      sha,
      text: "about that file",
      reply: { ...SNAP, file: true },
    });
    const results = await broadcast(frames, [alice, bob], alice.id);
    const file = results.find((r) => r.type === "file");
    expect(file).toBeDefined();
    if (file && file.type === "file") {
      expect(file.text).toBe("about that file");
      expect(file.reply).toEqual({ ...SNAP, file: true });
      expect(file.file.name).toBe("notes.bin");
    }
  });

  it("a tampered quote breaks the signature (the canonical covers the snapshot)", async () => {
    const [alice, bob, mallory] = await makeRoom(
      "REPL3",
      ["m-a", "m-b", "m-mallory"],
      await randomAesKey(),
    );
    const frames = await bob.cipher.sealText({
      text: "an honest answer",
      reply: { id: "msg-1", senderId: "m-a", snippet: "what alice actually said" },
    });
    // Mallory relabels bob's frame as their own — the signature was
    // made with bob's key over bob's canonical (which embeds the
    // quote), so verification against mallory's registered key fails.
    const forged = structuredClone(frames[0]);
    forged.from = mallory.id;
    const r = await alice.cipher.open(forged);
    expect(r.type).toBe("reject");
    // The relabel never even reaches the signature: the ciphertext's
    // authenticated sender binding refuses it first. The layer below
    // (the direct canonical test) proves the quote itself is covered.
  });

  it("a reply frame is indistinguishable in size from a plain message", async () => {
    const [alice] = await makeRoom("REPL4", ["m-a"], await randomAesKey());
    const plain = await alice.cipher.sealText({ text: "a plain message of some length" });
    const reply = await alice.cipher.sealText({
      text: "a plain message of some length",
      reply: { ...SNAP, senderId: "m-b" },
    });
    const sizes = [...plain, ...reply].map((f) => fromB64(f.ct).length);
    expect(new Set(sizes).size).toBe(1);
    expect(sizes[0]).toBe(CONTROL_FRAME_BYTES + 16);
  });

  it("replayed reply frames are refused by the replay guard", async () => {
    const [alice, bob] = await makeRoom("REPL5", ["m-a", "m-b"], await randomAesKey());
    const frames = await alice.cipher.sealText({
      text: "answer",
      reply: { ...SNAP, senderId: "m-b" },
    });
    const first = await bob.cipher.open(frames[0]);
    expect(first.type).toBe("text");
    const again = await bob.cipher.open(structuredClone(frames[0]));
    expect(again.type).toBe("reject");
  });

  it("replyCanonical is deterministic and shape-guarded", () => {
    expect(replyCanonical(SNAP)).toBe(replyCanonical({ ...SNAP }));
    expect(replyCanonical(SNAP)).toContain("the words being answered");
    expect(replyCanonical(undefined)).toBe("");
    expect(replyCanonical({ id: "x", senderId: "y", snippet: "z" })).toBe(
      replyCanonical({ id: "x", senderId: "y", snippet: "z", file: false }),
    );
    expect(replyCanonical({ id: "x", senderId: "y", snippet: "z", file: true })).not.toBe(
      replyCanonical({ id: "x", senderId: "y", snippet: "z" }),
    );
    // malformed shapes serialise as absent, never throw
    expect(
      replyCanonical({ id: 1, senderId: null, snippet: undefined } as never),
    ).toBe("");
  });

  it("changing the quote changes the canonical string (tamper = bad signature)", async () => {
    const { canonicalV2 } = await import("@/lib/protocol");
    const { signCanonical, verifyCanonical } = await import("@/lib/crypto");
    const pair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    );
    const priv = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const pub = await crypto.subtle.exportKey("jwk", pair.publicKey);
    const base = {
      roomId: "R",
      kv: 2,
      senderId: "m-a",
      sessionTag: "t",
      counter: 1,
      ts: 1234,
      kind: "text",
      text: "same words",
    } as const;
    const honest = canonicalV2({
      ...base,
      reply: { id: "msg-1", senderId: "m-b", snippet: "what was actually said" },
    });
    const forged = canonicalV2({
      ...base,
      reply: { id: "msg-1", senderId: "m-b", snippet: "what was NOT said" },
    });
    const sig = await signCanonical(priv, honest);
    expect(await verifyCanonical(pub, honest, sig)).toBe(true);
    // Same words, different quote: the signature no longer verifies.
    expect(await verifyCanonical(pub, forged, sig)).toBe(false);
  });
});

describe("reply snapshots", () => {
  const base: MessageView = {
    id: "m1",
    kind: "text",
    senderId: "m-b",
    status: "sent",
    ts: Date.now(),
    text: "",
  };

  it("collapses whitespace and caps the snippet", () => {
    const long = "word ".repeat(80).trim();
    const snap = makeReplySnapshot({ ...base, text: `  ${long}\n\nnext   line  ` });
    expect(snap.snippet.length).toBeLessThanOrEqual(REPLY_SNIPPET_MAX);
    expect(snap.snippet).not.toMatch(/\s{2,}/);
    expect(snap.snippet.startsWith("word word")).toBe(true);
    expect(snap.file).toBeUndefined();
  });

  it("a file target quotes its name and carries the file flag", () => {
    const snap = makeReplySnapshot({
      ...base,
      kind: "file",
      file: { name: "quarterly.csv", mime: "text/csv", size: 10 },
    });
    expect(snap.snippet).toBe("quarterly.csv");
    expect(snap.file).toBe(true);
  });

  it("a view-once target is never summarised by its contents", () => {
    const snap = makeReplySnapshot({
      ...base,
      kind: "file",
      viewOnce: true,
      file: { name: "secret-plan.pdf", mime: "application/pdf", size: 10 },
    });
    expect(snap.snippet).toBe("Sealed message");
    expect(snap.snippet).not.toContain("secret");
  });

  it("sanitiser caps hostile shapes and drops malformed ones", () => {
    const ok = sanitizeReplySnapshot({
      id: "x".repeat(200),
      senderId: "y",
      snippet: "z".repeat(500),
      file: true,
    });
    expect(ok?.id.length).toBe(64);
    expect(ok?.snippet.length).toBeLessThanOrEqual(REPLY_SNIPPET_MAX + 40);
    expect(ok?.file).toBe(true);
    expect(sanitizeReplySnapshot(null)).toBeUndefined();
    expect(sanitizeReplySnapshot("nope")).toBeUndefined();
    expect(sanitizeReplySnapshot({ id: "", senderId: "y", snippet: "z" })).toBeUndefined();
    expect(sanitizeReplySnapshot({ id: "x", senderId: "y", snippet: "   " })).toBeUndefined();
  });
});

describe("viewer classification", () => {
  it("routes every media family", () => {
    expect(classifyFile("image/png", "p.png")).toBe("image");
    expect(classifyFile("image/svg+xml", "d.svg")).toBe("image");
    expect(classifyFile("video/mp4", "v.mp4")).toBe("video");
    expect(classifyFile("audio/webm", "a.webm")).toBe("audio");
    expect(classifyFile("application/pdf", "d.pdf")).toBe("pdf");
    expect(classifyFile("application/octet-stream", "d.pdf")).toBe("pdf");
    expect(classifyFile("text/csv", "c.csv")).toBe("csv");
    expect(classifyFile("application/octet-stream", "c.csv")).toBe("csv");
    expect(classifyFile("text/html", "page.html")).toBe("text");
    expect(classifyFile("application/json", "d.json")).toBe("text");
    expect(classifyFile("application/octet-stream", "notes.txt")).toBe("text");
    expect(classifyFile("application/zip", "a.zip")).toBe("binary");
    expect(classifyFile("application/octet-stream", "blob")).toBe("binary");
  });
});

describe("csv parsing", () => {
  it("splits rows and columns", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("honours quotes: commas, newlines and doubled quotes inside fields", () => {
    const rows = parseCsv('name,note\n"Smith, John","said ""hi""\nstill talking"');
    expect(rows).toEqual([
      ["name", "note"],
      ["Smith, John", 'said "hi"\nstill talking'],
    ]);
  });

  it("tolerates CRLF and drops fully-empty rows", () => {
    expect(parseCsv("a,b\r\n\r\nc,d\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("keeps a single-column file as single-column rows", () => {
    expect(parseCsv("one\ntwo\nthree")).toEqual([["one"], ["two"], ["three"]]);
  });
});
