# CipherChat

A conversation that leaves no trace.

CipherChat is an ephemeral, end-to-end-encrypted chat with no accounts: a
room is a link and a password. Everything that matters happens in your
browser — the server is a blind relay that cannot read a single frame.

## What it is

- **No accounts.** Create a room, share the link and the password through
  different channels. That pair *is* the room.
- **Ephemeral by construction.** No message is ever stored on any server.
  New joiners see nothing from before they joined. Messages can carry a
  TTL (5m / 1h / 8h) and destroy themselves on schedule; the creator can
  burn the whole room for everyone.
- **Ink marks.** Mark any message with one of four quiet margin marks
  (✓ acknowledged · ✦ noted · ♥ warmly received · ☾ later). Marks are
  encrypted, signed, uniform-sized frames — the relay cannot even tell
  a mark happened.
- **Captioned files.** Attach a file with words — the caption rides the
  file's meta frame, canonical-signed like any text message.
- **Refresh locks every room.** Keys live only in memory. Reload the page
  and each room must be unlocked again with its password.
- **Honest identity.** You are a derived alias and a fingerprint others
  can verify out-of-band. Your signing key is per-room — the same device
  in two rooms is two different, unlinkable identities.

## How the crypto works (protocol v2)

| Property | Mechanism |
| --- | --- |
| Room entry key | argon2id (64 MB, t=3, p=1) from the password + a random salt in a versioned key bundle (legacy PBKDF2 rooms still unlock) |
| Every frame | JSON → ECDSA-P256 signature → **padded to a uniform size** → AES-256-GCM |
| Uniformity | All control frames (messages, typing, receipts, burns, key offers, file meta, ink marks) are the same size; every file transfer is the same fixed number of chunk frames — the relay cannot read file sizes or even tell typing from messages |
| Replay defense | per-sender monotonic counters, ±10-minute timestamp window, frame-id dedup, refresh-surviving watermarks |
| Rotation on leave | the remaining members seal the room under a **new random key**, delivered pairwise over ephemeral ECDH — the leaver never receives it, and it is not derived from the password |
| Rejoin after rotation | the current key arrives ECDH-wrapped and sealed under the password-derived entry key, so only a joiner who proved the password can open it |
| Forgery | messages are signed inside the encrypted payload and verified against the REST member registry; forgeries render as a quiet rejection line |
| Verifiability | fingerprints derive from registered public keys; verification marks live on your device |

The full property suite is enforced by tests named after the properties
they protect: `src/lib/__tests__/task-19.*.test.ts` (47 tests — replay,
rotation, padding, KDF, identity, hardening) plus `task-20.*.test.ts`
(file captions, ink reactions). Run them with `bun run test`.

## What CipherChat does NOT protect against

Read this part — it is the product's spine.

- **Metadata.** The relay sees who talks to whom, when, and how much.
  Frame sizes are uniform, so it cannot read file sizes or distinguish
  typing from messages — but the fact of communication is visible.
- **View-once is a promise, not enforcement.** Any member can passively
  decrypt a view-once file on arrival and keep it without opening the
  viewer. Inherent to group E2EE; Signal has the same limit.
- **Silent leavers keep the key.** Rotation fires when a member leaves.
  Someone who just closes the tab keeps the current key until the room's
  next rotation. For a hostile exit, burn the room.
- **Insiders can sabotage.** A member can always publish the room key
  out-of-band or push nuisance rotations. Group E2EE keeps outsiders
  out; it cannot police participants.
- **The password cannot be changed** for the room's lifetime. Password
  knowledge is permanent — which is exactly why rotation keys are random
  and password-independent.
- **Endpoint compromise.** Malware, XSS, or physical access to your
  device reads everything. No browser app can prevent that.
- **Not a nation-state adversary.** If your opponent is one, use Signal
  or SimpleX.

## Running it

```bash
bun run dev        # Next.js app on :3000
bun run dev        # (in mini-services/relay-service) blind relay on :3003
bun run test       # the Task 19 security property suite
bun run lint
```

The relay must be restarted manually after edits to
`mini-services/relay-service/index.ts` (bun --hot does not reliably
reload socket handlers).

## Documentation

- `DESIGN.md` — tokens, motion, architecture, and the full threat model
- `COMPONENTS.md` — every component, its states and mechanics
- `worklog.md` — the build history, round by round
