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
| Silent-departure grace | a member whose connection drops without a clean leave is written out **2 minutes** later: the relay's live presence (token-guarded, server-to-server) is the connection authority the eviction route consults, the epoch ledger makes the re-seal durable, and the departed member simply re-enters with the password when they return |
| Departure proof | leaving requires a signature from the member's registered key — a room-code holder cannot trigger nuisance rotations in your name |
| Rejoin after rotation | the current key arrives ECDH-wrapped and sealed under the password-derived entry key, so only a joiner who proved the password can open it |
| Forgery | messages are signed inside the encrypted payload and verified against the REST member registry; forgeries render as a quiet rejection line |
| Verifiability | fingerprints derive from registered public keys; verification marks live on your device |

The full property suite is enforced by tests named after the properties
they protect: `src/lib/__tests__/task-19.*.test.ts` (replay,
rotation, padding, KDF, identity, hardening), `task-20.*.test.ts`
(file captions, ink reactions), `task-21.1-silent-grace.test.ts` (the
silent-departure grace decision logic) and `task-22.*.test.ts`
(departure proofs, key-derivation range safety, room admission).
Run them with `bun run test`.

## What CipherChat does NOT protect against

Read this part — it is the product's spine.

- **Metadata.** The relay sees who talks to whom, when, and how much.
  Frame sizes are uniform, so it cannot read file sizes or distinguish
  typing from messages — but the fact of communication is visible.
- **View-once is a promise, not enforcement.** Any member can passively
  decrypt a view-once file on arrival and keep it without opening the
  viewer. Inherent to group E2EE; Signal has the same limit.
- **Silent leavers — closed by the grace.** A member who just closes the
  tab keeps the current key for at most **2 minutes**: their connection
  drop starts a grace clock on every remaining client, and the connected
  coordinator asks the server to write them out and re-seal when it
  expires. The residual window is the grace itself — and for a hostile
  exit, burn the room.
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

### Development (two terminals)

```bash
bun run dev                                        # Next.js app on :3000

cd mini-services/relay-service && bun run dev     # blind relay on :3003
                                                   # (+ internal presence on :3004)
bun run test                                       # the security property suite
bun run lint
```

The relay must be restarted manually after edits to
`mini-services/relay-service/index.ts` (bun --hot does not reliably
reload socket handlers).

The relay URL is configuration, not code: `NEXT_PUBLIC_RELAY_URL`
(defaults to same-origin `/relay/`, which a reverse proxy forwards to
the relay — see `deploy/Caddyfile`). Every variable is documented in
`.env.example`.

### Production — one plain VPS

```bash
cd deploy
cp .env.example .env        # set RELAY_INTERNAL_TOKEN (openssl rand -hex 24)
                            # and CADDY_SITE (your domain, or localhost for testing)
docker compose up -d        # app + relay + Caddy with automatic TLS
```

That is the whole self-host story: `deploy/` contains the web Dockerfile
(Next.js standalone output + Prisma), the relay Dockerfile, and the
compose file that wires them behind Caddy. `docker compose down -v`
removes the database volume too — burn your rooms first if you mean it.

On a machine with only Docker installed, `docker compose up` gives a
working HTTPS site; verify the golden path with **two devices** (two
origins, not two tabs — tabs share localStorage): create, join, message,
rotate-on-leave, rejoin, file, view-once, burn.

### CI

`.github/workflows/ci.yml` runs lint → `tsc --noEmit` → the full property
suite → `npm audit --audit-level=high` → production build. Red means no
merge — the property suite is the security contract.

### Performance note

Room unlocking is deliberately slow (argon2id, 64 MB). On a desktop this
takes ~1 second; on a low-end Android it can take 5–8 seconds — that is
the cost of grinding resistance, not a bug. The sealing screen says so.

## Legal

- `LICENSE` — MIT
- `public/legal/terms.md` — Terms of Use (served in-app from the
  landing footer and Settings → About)
- `public/legal/privacy.md` — Privacy Policy (same)

## Reporting abuse

The architecture permits exactly one act of moderation: ending a
room. There is no content to review (the server is blind), no member
to suspend (identity is per-room and derived), no history to scrub
(none is stored). Rooms being misused can be reported to
**abuse@cipherchat.app** (also listed in Settings → About) or
terminated directly with the rate-limited
`POST /api/rooms/:roomId/report` endpoint, which destroys the
registry, withdraws the verifier, and tells every connected member
the room is gone. Self-hosters should publish their own contact and
expect the same ceiling: anyone who knows a room's ID can end it.

## Documentation

- `DESIGN.md` — tokens, motion, architecture, and the full threat model
- `COMPONENTS.md` — every component, its states and mechanics
- `worklog.md` — the build history, round by round
