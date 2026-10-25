// Task 22.2: SCALAR RANGE HANDLING IN ROOM IDENTITY DERIVATION
//
// Property: a derived room signing key is only accepted when its
// scalar is a VALID P-256 private scalar: an integer in [1, n-1].
// The check is EXPLICIT (bigint comparison), not an incidental
// side effect of a library throwing, so the validity of every
// identity ever registered is auditable in one pure function.

import { describe, it, expect } from "vitest";
import { p256 } from "@noble/curves/nist.js";
import { scalarToRoomIdentity } from "@/lib/room-identity";
import { signCanonical, verifyCanonical } from "@/lib/crypto";

const N = p256.Point.CURVE().n;

// BigInt() calls instead of literals, because the repo targets ES2017.
function b64urlToBigInt(s: string): bigint {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  let n = BigInt(0);
  for (let i = 0; i < raw.length; i++) n = (n << BigInt(8)) | BigInt(raw.charCodeAt(i));
  return n;
}

function bigIntTo32BytesBE(n: bigint): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(n & BigInt(0xff));
    n >>= BigInt(8);
  }
  return out;
}

describe("scalar range handling in room identity derivation", () => {
  it("accepts ~50 random 32-byte scalars, each strictly within [1, n-1], sign/verify round-trip", async () => {
    for (let i = 0; i < 50; i++) {
      const scalar = crypto.getRandomValues(new Uint8Array(32));
      const identity = await scalarToRoomIdentity(scalar);
      expect(identity).not.toBeNull();
      const d = b64urlToBigInt(identity!.privJwk.d!);
      expect(d).toBeGreaterThanOrEqual(BigInt(1));
      expect(d).toBeLessThanOrEqual(N - BigInt(1));
      // The identity must be a working WebCrypto ECDSA P-256 pair.
      const sig = await signCanonical(identity!.privJwk, `probe-${i}`);
      expect(await verifyCanonical(identity!.pubJwk, `probe-${i}`, sig)).toBe(true);
    }
  });

  it("rejects out-of-range scalars: all-zero, exactly n, n+1, and 2^256-1 → null", async () => {
    expect(await scalarToRoomIdentity(new Uint8Array(32))).toBeNull();
    expect(await scalarToRoomIdentity(bigIntTo32BytesBE(N))).toBeNull();
    expect(await scalarToRoomIdentity(bigIntTo32BytesBE(N + BigInt(1)))).toBeNull();
    expect(await scalarToRoomIdentity(new Uint8Array(32).fill(0xff))).toBeNull();
  });

  it("n-1 is the last valid scalar (non-null)", async () => {
    const identity = await scalarToRoomIdentity(bigIntTo32BytesBE(N - BigInt(1)));
    expect(identity).not.toBeNull();
    expect(b64urlToBigInt(identity!.privJwk.d!)).toBe(N - BigInt(1));
  });

  it("is deterministic: the same scalar twice → identical fingerprints", async () => {
    const scalar = crypto.getRandomValues(new Uint8Array(32));
    const a = await scalarToRoomIdentity(scalar);
    const b = await scalarToRoomIdentity(scalar);
    expect(a!.fingerprintHex).toBe(b!.fingerprintHex);
    expect(a!.privJwk.d).toBe(b!.privJwk.d);
    expect(a!.pubJwk.x).toBe(b!.pubJwk.x);
  });

  it("different scalars → different fingerprints (whp)", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const identity = await scalarToRoomIdentity(crypto.getRandomValues(new Uint8Array(32)));
      seen.add(identity!.fingerprintHex);
    }
    expect(seen.size).toBe(20);
  });
});
