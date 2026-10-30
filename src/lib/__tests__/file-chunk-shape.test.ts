// The file assembler: the chunk shape and the byte budget.
//
// A file arrives as one meta frame plus a fixed number of chunk
// frames. Before this check, the assembler took the sender's word for
// the chunk shape: any total, any seq, any data. A member could feed
// it an unbounded number of distinct chunks for one file, and the
// assembler held every one of them.
//
// The tests below seal malformed frames the way a member would, with a
// signature the receiver accepts, so the shape checks are the ones
// under test and not the signature check in front of them.

import { describe, it, expect } from "vitest";
import {
  FILE_CHUNK_B64,
  FILE_FRAME_BYTES,
  FILE_MAX_BYTES,
  FILE_TOTALS,
  createSendClock,
  sealFrame,
  type WireFrame,
} from "@/lib/protocol";
import { sha256HexOfBytes } from "@/lib/crypto";
import { makeRoom, randomAesKey, type TestMember } from "./helpers";

// The chunk count of the largest bucket: the total a file split
// across the whole payload carries.
const bucketTotal = FILE_TOTALS[FILE_TOTALS.length - 1];

const ROOM = "ROOM-FILE";

/** Seal a body the room cipher would never produce, but with a
 *  signature the receiver accepts. */
async function sealRaw(
  alice: TestMember,
  key: CryptoKey,
  body: Record<string, unknown>,
  clock: ReturnType<typeof createSendClock>,
): Promise<WireFrame> {
  return sealFrame({
    key,
    roomId: ROOM,
    kv: 1,
    senderId: alice.id,
    clock,
    body,
    frameSize: FILE_FRAME_BYTES,
    sigPrivJwk: alice.privJwk,
  });
}

/** A meta for a transfer that never completes. */
async function openMeta(
  alice: TestMember,
  bob: TestMember,
  key: CryptoKey,
  messageId: string,
  clock: ReturnType<typeof createSendClock>,
  patch: (file: Record<string, unknown>) => Record<string, unknown> = (f) => f,
) {
  const file = patch({
    messageId,
    name: "photo.bin",
    mime: "application/octet-stream",
    size: 10,
    sha: "a".repeat(64),
  });
  const frame = await sealRaw(alice, key, { kind: "file:meta", file }, clock);
  return bob.cipher.open(frame);
}

describe("file transfer: the chunk shape", () => {
  it("a chunk whose total is not the fixed count is refused", async () => {
    const key = await randomAesKey();
    const [alice, bob] = await makeRoom(ROOM, ["m-a", "m-b"], key);
    const clock = createSendClock();
    expect((await openMeta(alice, bob, key, "f1", clock)).type).toBe("file-meta");

    // The accepted totals are the size buckets' chunk counts. Anything
    // else is refused.
    for (const total of [bucketTotal + 1, 1, 0, -1, 1e9, 2.5]) {
      const frame = await sealRaw(
        alice,
        key,
        { kind: "file:chunk", chunk: { messageId: "f1", seq: 0, total, dataB64: "AAAA" } },
        clock,
      );
      const r = await bob.cipher.open(frame);
      expect(r.type, `total ${total}`).toBe("reject");
      if (r.type === "reject") expect(r.reason, `total ${total}`).toBe("shape");
    }
  });

  it("a chunk whose seq is outside the fixed range is refused", async () => {
    const key = await randomAesKey();
    const [alice, bob] = await makeRoom(ROOM, ["m-a", "m-b"], key);
    const clock = createSendClock();
    expect((await openMeta(alice, bob, key, "f1", clock)).type).toBe("file-meta");

    for (const seq of [-1, bucketTotal, bucketTotal + 10, 1.5, NaN, Infinity]) {
      const frame = await sealRaw(
        alice,
        key,
        {
          kind: "file:chunk",
          chunk: { messageId: "f1", seq, total: bucketTotal, dataB64: "AAAA" },
        },
        clock,
      );
      const r = await bob.cipher.open(frame);
      expect(r.type, `seq ${seq}`).toBe("reject");
      if (r.type === "reject") expect(r.reason, `seq ${seq}`).toBe("shape");
    }
  });

  it("a chunk with an empty or oversized payload is refused", async () => {
    const key = await randomAesKey();
    const [alice, bob] = await makeRoom(ROOM, ["m-a", "m-b"], key);
    const clock = createSendClock();
    expect((await openMeta(alice, bob, key, "f1", clock)).type).toBe("file-meta");

    const empty = await sealRaw(
      alice,
      key,
      {
        kind: "file:chunk",
        chunk: { messageId: "f1", seq: 0, total: bucketTotal, dataB64: "" },
      },
      clock,
    );
    expect((await bob.cipher.open(empty)).type).toBe("reject");

    const huge = await sealRaw(
      alice,
      key,
      {
        kind: "file:chunk",
        chunk: {
          messageId: "f1",
          seq: 0,
          total: bucketTotal,
          dataB64: "A".repeat(FILE_CHUNK_B64 + 1),
        },
      },
      clock,
    );
    const r = await bob.cipher.open(huge);
    expect(r.type).toBe("reject");
    if (r.type === "reject") expect(r.reason).toBe("shape");
  });

  it("a chunk for a transfer that was never announced is refused", async () => {
    const key = await randomAesKey();
    const [alice, bob] = await makeRoom(ROOM, ["m-a", "m-b"], key);
    const clock = createSendClock();
    const frame = await sealRaw(
      alice,
      key,
      {
        kind: "file:chunk",
        chunk: { messageId: "never", seq: 0, total: bucketTotal, dataB64: "AAAA" },
      },
      clock,
    );
    const r = await bob.cipher.open(frame);
    expect(r.type).toBe("reject");
    if (r.type === "reject") expect(r.reason).toBe("shape");
  });

  it("a meta whose size, sha, name or mime is nonsense is refused", async () => {
    const key = await randomAesKey();
    const [alice, bob] = await makeRoom(ROOM, ["m-a", "m-b"], key);
    const clock = createSendClock();

    const cases: Record<string, unknown>[] = [
      { size: FILE_MAX_BYTES + 1 },
      { size: -1 },
      { size: 1.5 },
      { size: "10" },
      { sha: "not-a-sha" },
      { sha: "A".repeat(64) },
      { name: "x".repeat(257) },
      { mime: "x".repeat(129) },
    ];
    for (const patch of cases) {
      const r = await openMeta(alice, bob, key, "f1", clock, (f) => ({ ...f, ...patch }));
      expect(r.type, JSON.stringify(patch)).toBe("reject");
      if (r.type === "reject") expect(r.reason, JSON.stringify(patch)).toBe("shape");
    }
  });

  it("an honest file still arrives", async () => {
    const key = await randomAesKey();
    const [alice, bob] = await makeRoom(ROOM, ["m-a", "m-b"], key);
    const raw = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
    const dataB64 = Buffer.from(raw).toString("base64");
    const frames = await alice.cipher.sealFile({
      name: "photo.bin",
      mime: "application/octet-stream",
      size: raw.length,
      dataB64,
      sha: await sha256HexOfBytes(raw),
    });
    let got: import("@/lib/room-protocol").OpenResult | undefined;
    for (const f of frames) {
      const r = await bob.cipher.open(f);
      if (r.type === "file") got = r;
    }
    expect(got?.type).toBe("file");
  });
});

describe("file transfer: the pending byte budget", () => {
  it("a chunk that does not fit evicts the oldest transfer instead of growing", async () => {
    const key = await randomAesKey();
    // A small ceiling, so the test does not move sixteen megabytes.
    const [alice, bob] = await makeRoom(ROOM, ["m-a", "m-b"], key, {
      pendingFileByteBudget: 200_000,
    });
    const clock = createSendClock();
    expect((await openMeta(alice, bob, key, "old", clock)).type).toBe("file-meta");
    expect((await openMeta(alice, bob, key, "new", clock)).type).toBe("file-meta");

    const chunk = async (messageId: string, seq: number) => {
      const frame = await sealRaw(
        alice,
        key,
        {
          kind: "file:chunk",
          chunk: {
            messageId,
            seq,
            total: bucketTotal,
            dataB64: "A".repeat(FILE_CHUNK_B64),
          },
        },
        clock,
      );
      return bob.cipher.open(frame);
    };

    // Three chunks fit in the 200k ceiling.
    expect((await chunk("old", 0)).type).toBe("file-chunk");
    expect((await chunk("old", 1)).type).toBe("file-chunk");
    expect((await chunk("old", 2)).type).toBe("file-chunk");

    // The fourth does not fit, so the oldest transfer is dropped and
    // the new one is accepted.
    expect((await chunk("new", 0)).type).toBe("file-chunk");

    // The dropped transfer is gone: its next chunk has nowhere to go.
    const after = await chunk("old", 3);
    expect(after.type).toBe("reject");
    if (after.type === "reject") expect(after.reason).toBe("shape");
  });

  it("a chunk that cannot fit even on an empty budget is refused", async () => {
    const key = await randomAesKey();
    const [alice, bob] = await makeRoom(ROOM, ["m-a", "m-b"], key, {
      pendingFileByteBudget: 1_000,
    });
    const clock = createSendClock();
    expect((await openMeta(alice, bob, key, "f1", clock)).type).toBe("file-meta");
    const frame = await sealRaw(
      alice,
      key,
      {
        kind: "file:chunk",
        chunk: {
          messageId: "f1",
          seq: 0,
          total: bucketTotal,
          dataB64: "A".repeat(FILE_CHUNK_B64),
        },
      },
      clock,
    );
    const r = await bob.cipher.open(frame);
    expect(r.type).toBe("reject");
    if (r.type === "reject") expect(r.reason).toBe("shape");
  });
});
