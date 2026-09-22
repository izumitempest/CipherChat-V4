"use client";

import { Section } from "./section";

/* The protocol: every mechanism to the constant, every constant
 * enforced by a test named after the property it protects. This
 * is the one page where the algorithm names belong. */

const ROWS = [
  [
    "Room entry key",
    "argon2id (64 MB, t=3, p=1) over the password and a random salt, in a versioned key bundle. Legacy PBKDF2 rooms still unlock.",
  ],
  [
    "Every frame",
    "JSON, then an ECDSA-P256 signature, then padding to a uniform size, then AES-256-GCM.",
  ],
  [
    "Uniformity",
    "Messages, typing, receipts, burns, key offers, file metadata, and ink marks are all the same size. Every file uses the same fixed number of chunk frames.",
  ],
  [
    "Replay defense",
    "Per-sender monotonic counters, a ±10-minute timestamp window, frame-id dedup, and watermarks that survive refresh.",
  ],
  [
    "Rotation on leave",
    "A new random key, delivered to each remaining member over ephemeral ECDH. It is not derived from the password.",
  ],
  [
    "Silent-departure grace",
    "A dropped connection starts a 2-minute clock on every remaining client. The write-out requires a departure signature and the relay's live presence.",
  ],
  [
    "Departure proof",
    "Leaving requires a signature from the member's registered key. A room-code holder cannot trigger a rotation in your name.",
  ],
  [
    "Rejoin after rotation",
    "The current key arrives ECDH-wrapped and encrypted under the entry key. Only a joiner who has proved the password can open it.",
  ],
  [
    "Forgery",
    "Signatures are verified against the REST member registry. A forged message is rejected and shown as a system line.",
  ],
  [
    "Verifiability",
    "Fingerprints derive from registered public keys. Verification marks stay on your device.",
  ],
] as const;

export function Protocol() {
  return (
    <Section
      id="protocol"
      title="The protocol"
      lede="Every mechanism is written down. Each constant is enforced by a test named after the property it protects."
    >
      <div className="scroll-quiet overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-left">
          <thead>
            <tr className="border-b border-hairline">
              <th
                scope="col"
                className="pb-3 pr-6 font-sans text-[12.5px] font-medium text-mute"
              >
                Property
              </th>
              <th
                scope="col"
                className="pb-3 font-sans text-[12.5px] font-medium text-mute"
              >
                Mechanism
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([property, mechanism]) => (
              <tr key={property} className="border-b border-hairline">
                <th
                  scope="row"
                  className="w-[30%] py-3.5 pr-6 align-top font-sans text-[13.5px] font-semibold leading-[1.5]"
                >
                  {property}
                </th>
                <td className="py-3.5 align-top font-sans text-[13.5px] leading-[1.65] text-charcoal/85">
                  {mechanism}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-5 max-w-[74ch] font-sans text-[13.5px] leading-[1.7] text-mute">
        The constants live in the source files ({" "}
        <code className="rounded-[4px] bg-side px-1.5 py-0.5 font-mono text-[12px] text-charcoal/80">
          identity.ts
        </code>
        ,{" "}
        <code className="rounded-[4px] bg-side px-1.5 py-0.5 font-mono text-[12px] text-charcoal/80">
          protocol.ts
        </code>
        ,{" "}
        <code className="rounded-[4px] bg-side px-1.5 py-0.5 font-mono text-[12px] text-charcoal/80">
          silent-grace.ts
        </code>
        ). The test suite is named after the properties it protects:
        replay, rotation, padding, KDF, identity, hardening, grace,
        departure proofs, admission, and replies. Current test counts are in
        CHANGES.md.
      </p>
    </Section>
  );
}
