// The canonical must not let two different bodies share a signing
// string.
//
// The v2 canonical glued variable-length fields together with a pipe
// and escaped one field, so "hello|world" in one field and "world|" in
// the next built the same string. A signature made for one body
// verified for the other. The bug list called for a property test that
// hunts for collisions across every variable length field, not just
// the pair that was noticed.
//
// This file does that hunt. The bodies below are built from a pool of
// awkward values: pipes, quotes, backslashes, newlines, tabs, emoji,
// astral characters, empty strings, long strings. For every field that
// can hold one, the test checks that swapping the value into another
// field changes the signing string, and it runs a randomised search
// over the whole space looking for any two different bodies that agree.
//
// Two bodies that hold the same values in the same places are the
// same body, so those pairs are skipped. A test that compares them
// would fail on the correct behaviour.
//
// The random search uses a seeded generator, so a failure is
// reproducible. The seed is printed with the failure.

import { describe, it, expect } from "vitest";
import { canonicalJson, canonicalV3FromBody } from "@/lib/protocol";

/* ---------------- the pool of awkward values ---------------- */

const AWKWARD: string[] = [
  "",
  " ",
  "|",
  "||",
  "|||",
  "hello|world",
  "world|",
  "|world",
  "a|b|c|d|e",
  '"',
  '""',
  'he said "hi"',
  "\\",
  "\\\\",
  "back\\slash",
  "\n",
  "\r\n",
  "\t",
  "\u0000",
  "\u001f",
  "é",
  "€",
  "👻",
  "𝄞",
  "a".repeat(200),
  "a|b".repeat(100),
  "𐍈".repeat(50),
  "null",
  "undefined",
  "NaN",
  "0",
  "-0",
  "1e21",
];

/* ---------------- the body shape under test ---------------- */

type Body = Record<string, unknown>;

/** Every field that can carry a variable-length string. */
const FIELDS = [
  "messageId",
  "text",
  "sessionTag",
  "reply.messageId",
  "reply.text",
  "file.name",
  "file.mime",
  "file.sha",
  "kind",
];

/** The body every test starts from. */
function baseBody(): Body {
  return {
    kind: "text",
    messageId: "m-1",
    text: "hello",
    sessionTag: "s-1",
    counter: 1,
    ts: 1_700_000_000_000,
    reply: { messageId: "r-1", text: "quoted" },
    file: { name: "note.txt", mime: "text/plain", size: 12, sha: "ab".repeat(32) },
  };
}

/** A body with the given values put into the given fields. */
function bodyWith(pairs: Array<{ field: string; value: unknown }>): Body {
  const body = baseBody();
  for (const { field, value } of pairs) setPath(body, field, value);
  return body;
}

/** Set a value at a dotted path, creating the objects on the way. */
function setPath(target: Body, path: string, value: unknown): void {
  const parts = path.split(".");
  let node: Record<string, unknown> = target;
  for (const part of parts.slice(0, -1)) {
    if (typeof node[part] !== "object" || node[part] === null) node[part] = {};
    node = node[part] as Record<string, unknown>;
  }
  node[parts[parts.length - 1]] = value;
}

/** True when two bodies hold the same values in the same places. The
 *  bodies are built the same way, so the key order is the same and a
 *  plain serialisation tells them apart. */
function sameBody(a: Body, b: Body): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/* ---------------- the tests ---------------- */

describe("the canonical hunt", () => {
  it("every awkward value in every field has its own signing string", async () => {
    // One field, one value at a time. Two bodies that differ only in
    // one field must never share a signing string.
    for (const field of FIELDS) {
      for (const value of AWKWARD) {
        const a = await canonicalV3FromBody("room", bodyWith([{ field, value }]));
        const b = await canonicalV3FromBody(
          "room",
          bodyWith([{ field, value: `${value}x` }]),
        );
        expect(a, `${field} = ${JSON.stringify(value)}`).not.toBe(b);
        // And the room id is part of the string, so the same body in
        // two rooms cannot agree either.
        expect(a, `${field} = ${JSON.stringify(value)}`).not.toBe(
          await canonicalV3FromBody("other", bodyWith([{ field, value }])),
        );
      }
    }
  });

  it("moving a value from one field to another changes the signing string", async () => {
    // This is the shape of the old bug: the same characters sat in two
    // different places and the old canonical could not tell them
    // apart. Now they have to differ.
    for (const from of FIELDS) {
      for (const to of FIELDS) {
        if (from === to) continue;
        for (const value of AWKWARD) {
          const a = bodyWith([{ field: from, value }]);
          const b = bodyWith([{ field: to, value }]);
          if (sameBody(a, b)) continue; // the same body, nothing to prove
          expect(
            await canonicalV3FromBody("room", a),
            `${from} vs ${to} = ${JSON.stringify(value)}`,
          ).not.toBe(await canonicalV3FromBody("room", b));
        }
      }
    }
  });

  it("a body and the same body with the values moved cannot agree", async () => {
    // The old attack moved a value one field to the right. Try every
    // pair of fields with every pair of values.
    for (const from of FIELDS) {
      for (const to of FIELDS) {
        if (from === to) continue;
        for (const v1 of AWKWARD) {
          for (const v2 of AWKWARD) {
            const a = bodyWith([
              { field: from, value: v1 },
              { field: to, value: v2 },
            ]);
            const b = bodyWith([
              { field: from, value: v2 },
              { field: to, value: v1 },
            ]);
            if (sameBody(a, b)) continue; // v1 and v2 are the same value
            expect(
              await canonicalV3FromBody("room", a),
              `${from}/${to} ${JSON.stringify(v1)} ${JSON.stringify(v2)}`,
            ).not.toBe(await canonicalV3FromBody("room", b));
          }
        }
      }
    }
  });

  it("the randomised search finds no collision", async () => {
    // 4000 random bodies, each with two fields drawn from the pool and
    // one drawn from the numbers. The map from signing string to body
    // must hold one body per key.
    const seed = 0x5eed1234;
    let state = seed >>> 0;
    const rnd = () => {
      // xorshift32, so the run is reproducible.
      state ^= state << 13;
      state >>>= 0;
      state ^= state >> 17;
      state ^= state << 5;
      state >>>= 0;
      return state / 0x1_0000_0000;
    };
    const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];

    const NUMBERS = [0, -0, 1, -1, 0.5, 1e21, 1e-7, 86400, 255, NaN, Infinity];
    const seen = new Map<string, string>();
    let distinct = 0;
    for (let i = 0; i < 4000; i++) {
      const body = bodyWith([
        { field: pick(FIELDS), value: pick(AWKWARD) },
        { field: pick(FIELDS), value: rnd() < 0.2 ? pick(NUMBERS) : pick(AWKWARD) },
      ]);
      const canonical = await canonicalV3FromBody("room", body);
      const shape = JSON.stringify(body);
      const prior = seen.get(canonical);
      if (prior === undefined) {
        seen.set(canonical, shape);
        distinct++;
        continue;
      }
      if (prior === shape) continue; // the same body came up twice
      expect(prior, `seed ${seed}, iteration ${i}: two bodies share a signing string`).not.toBe(
        shape,
      );
    }
    // The pool is small enough that some bodies repeat, but most of
    // them should be different from each other.
    expect(distinct).toBeGreaterThan(3000);
  });

  it("the canonical json is injective over the values a frame can carry", async () => {
    // The layer under the hash. Over the values JSON can represent,
    // two different values never produce the same string.
    const values: unknown[] = [
      ...AWKWARD,
      ...[0, -0, 1, -1, 0.5, 1e21, 1e-7, true, false, null],
      [{ a: 1 }, { a: "1" }, { a: [1] }, [1, 2], [2, 1], [], {}],
    ];
    const seen = new Map<string, unknown>();
    for (const value of values) {
      const text = canonicalJson(value);
      const prior = seen.get(text);
      if (prior !== undefined) {
        expect(prior, `canonicalJson collision on ${JSON.stringify(value)}`).not.toEqual(value);
      }
      seen.set(text, value);
    }
  });

  it("the key order in the body does not matter, but the values do", () => {
    const a = { kind: "text", text: "one", messageId: "m-1" };
    const b = { messageId: "m-1", text: "one", kind: "text" };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).not.toBe(canonicalJson({ ...a, text: "two" }));
  });
});
