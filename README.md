<div align="center">

<img src="assets/banner.svg" alt="CipherChat — a conversation that leaves no trace" width="880" />

<br />

<a href="https://readme-typing-svg.demolab.com"><img src="https://readme-typing-svg.demolab.com?font=Georgia&size=18&pause=1600&color=C85A40&center=true&vCenter=true&random=false&width=620&lines=A+room+is+a+link+and+a+password.;The+server+relays+ciphertext+it+cannot+read.;Keys+are+derived+and+held+in+your+browser.;No+accounts.+No+history.+No+trace.;Burn+it+when+you%27re+done." alt="CipherChat, one true line at a time" width="620" /></a>

<p>
  <img src="https://img.shields.io/badge/license-MIT-3A4F41?style=flat-square" alt="License: MIT" />
  <img src="https://img.shields.io/badge/e2e-encrypted-3A4F41?style=flat-square" alt="End-to-end encrypted" />
  <img src="https://img.shields.io/badge/relay-zero--knowledge-2C2A28?style=flat-square" alt="Zero-knowledge relay" />
  <img src="https://img.shields.io/badge/tests-property--driven-3A4F41?style=flat-square" alt="Property-driven test suite" />
  <img src="https://img.shields.io/badge/self--host-docker--compose-2C2A28?style=flat-square" alt="Self-host with docker compose" />
  <img src="https://img.shields.io/badge/rooms-burn--after--reading-C85A40?style=flat-square" alt="Rooms burn after reading" />
</p>

<p>
  <img src="https://skillicons.dev/icons?i=ts,react,nextjs,tailwind,bun,docker" alt="TypeScript, React, Next.js, Tailwind CSS, Bun, Docker" height="40" />
</p>

</div>

---

CipherChat is an ephemeral, end-to-end-encrypted chat with no accounts: a
room is a link and a password. Everything that matters happens in your
browser. The server is a blind relay that cannot read a single frame.

## What it is

- **No accounts.** Create a room, share the link and the password through
  different channels. That pair *is* the room.
- **Ephemeral by construction.** No message is ever stored on any server.
  New joiners see nothing from before they joined. Messages can carry a
  TTL (presets from 15 seconds to 8 hours, custom anywhere in
  5 seconds to 24 hours; the steps live in `TTL_STEPS`,
  `src/lib/types.ts`) and destroy themselves on schedule. The creator
  can burn the whole room for everyone.
- **Ink marks.** Mark any message with one of four quiet margin marks
  (✓ acknowledged · ✦ noted · ♥ warmly received · ☾ later). Marks are
  encrypted, signed, uniform-sized frames. The relay cannot even tell
  a mark happened.
- **Captioned files.** Attach a file with words. The caption rides the
  file's meta frame, canonical-signed like any text message.
- **Refresh locks every room.** Keys live only in memory. Reload the page
  and each room must be unlocked again with its password.
- **Honest identity.** You are a derived alias and a fingerprint others
  can verify out-of-band. Your signing key is per-room: the same device
  in two rooms is two different, unlinkable identities.

## How the crypto works (protocol v2)

| Property | Mechanism |
| --- | --- |
| Room entry key | argon2id (64 MB, t=3, p=1) from the password + a random salt in a versioned key bundle (legacy PBKDF2 rooms still unlock) |
| Every frame | JSON → ECDSA-P256 signature → **padded to a uniform size** → AES-256-GCM |
| Uniformity | All control frames (messages, typing, receipts, burns, key offers, file meta, ink marks) are the same size; every file transfer is the same fixed number of chunk frames, so the relay cannot read file sizes or even tell typing from messages |
| Replay defense | per-sender monotonic counters, ±10-minute timestamp window, frame-id dedup, refresh-surviving watermarks |
| Rotation on leave | the remaining members switch to a **new random key**, delivered pairwise over ephemeral ECDH. The leaver never receives it, and it is not derived from the password |
| Silent-departure grace | a member whose connection drops without a clean leave is removed **2 minutes** later while anyone remains connected. The clock lives on the remaining clients: the relay's live presence (token-guarded, server-to-server) is the connection authority the eviction route consults, the epoch ledger makes the rotation durable, and the departed member simply re-enters with the password when they return |
| Departure proof | leaving requires a signature from the member's registered key. A room-code holder cannot trigger nuisance rotations in your name |
| Rejoin after rotation | the current key arrives ECDH-wrapped and encrypted under the password-derived entry key, so only a joiner who proved the password can open it |
| Forgery | messages are signed inside the encrypted payload and verified against the REST member registry; forgeries render as a quiet rejection line |
| Verifiability | fingerprints derive from registered public keys; verification marks live on your device |

The constants behind these rows (KDF parameters, replay windows, the
120-second grace clock) live in `src/lib/` (`identity.ts`,
`protocol.ts`, `silent-grace.ts`), and every one is enforced by a
property test.

The full property suite is enforced by tests named after the properties
they protect: replay, rotation, padding, KDF, identity, hardening,
silent-departure grace, departure proofs, admission, reply integrity,
canonical collision-proofing, report grading, passphrase CSPRNG source.
The per-round inventory and the current count live in `CHANGES.md`
(this section deliberately does not restate them; duplicated counts
rot). Run the suite with `bun run test`.

## What CipherChat does NOT protect against

Read this part. It is the product's spine.

- **Metadata.** The relay sees who talks to whom, when, and how much.
  Frame sizes are uniform, so it cannot read file sizes or distinguish
  typing from messages, but the fact of communication is visible.
- **View-once is a promise, not enforcement.** Any member can passively
  decrypt a view-once file on arrival and keep it without opening the
  viewer. Inherent to group E2EE; Signal has the same limit.
- **Silent leavers, closed by the grace.** A member who just closes the
  tab keeps the current key for at most **2 minutes while anyone remains
  connected**: their connection drop starts a grace clock on every
  remaining client, and the connected coordinator asks the server to
  remove them and rotate the key when it expires. If everyone has left, no
  clock runs (an empty room has no traffic to decrypt), and the next
  rejoin rotates past any key they held (a room still on its
  first, password-derived key never had secrecy from password-holders;
  that limit is its own bullet below). The remaining window is the grace
  itself. For a hostile exit, burn the room.
- **Insiders can sabotage.** A member can always publish the room key
  out-of-band or push nuisance rotations. Group E2EE keeps outsiders
  out; it cannot police participants.
- **The password cannot be changed** for the room's lifetime. Password
  knowledge is permanent. That is exactly why rotation keys are random
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
the relay; see `deploy/Caddyfile`). Every variable is documented in
`.env.example`.

### Production: one plain VPS

```bash
cd deploy
cp .env.example .env        # set RELAY_INTERNAL_TOKEN (openssl rand -hex 24)
                            # and CADDY_SITE (your domain, or localhost for testing)
docker compose up -d        # app + relay + Caddy with automatic TLS
```

That is the whole self-host story: `deploy/` contains the web Dockerfile
(Next.js standalone output + Prisma), the relay Dockerfile, and the
compose file that wires them behind Caddy. `docker compose down -v`
removes the database volume too. Burn your rooms first if you mean it.

On a machine with only Docker installed, `docker compose up` gives a
working HTTPS site; verify the golden path with **two devices** (two
origins, not two tabs; tabs share localStorage): create, join, message,
rotate-on-leave, rejoin, file, view-once, burn.

### E2E: the golden path, automated

`tests/e2e/golden-path.spec.ts` (Playwright) drives the whole product
through one conversation with **two browser contexts** (same origin,
isolated storage), which retires the two-origins trick manual QA needed:
create → join → message → reply → react → GPS-tagged JPEG through the
EXIF strip (byte-verified in the receiver's viewer) → view-once (opened,
no download, spent propagates) → leave → rotation → rejoin (fresh joiner
sees no history, but the rotated key delivers) → burn (both ends run
the burn sequence).

```bash
bunx playwright install chromium   # once
bunx playwright test                # against a running dev stack (base URL
                                    # configurable via E2E_BASE_URL)
```

### CI

`.github/workflows/ci.yml` runs two jobs:

- **verify**: lint → `tsc --noEmit` (the relay included) → the full
  property suite → the dependency audit → production build. The audit
  is split honestly: the **runtime tree** gate is blocking (exceptions
  enumerated per advisory in `scripts/audit-gate.mjs` + `AUDIT.md`),
  the full-tree view is advisory and dispositioned per advisory.
- **e2e**: builds the production compose stack on the runner (web +
  relay + Caddy), waits for it to answer, and drives the golden path
  through it; traces, screenshots, and stack logs upload on failure.

Red means no merge. The property suite is the security contract, and
the golden path is the product contract.

### Releases

Pushing a tag (`v*`) fires `.github/workflows/release.yml`: the
property suite runs first, then a GitHub release is created from
`RELEASE_NOTES.md`. A red suite means no release, the same rule as
CI. Tags containing a hyphen (rc, beta) are marked prerelease
automatically. If you would rather create a release without the
workflow:

```bash
gh release create v1.0.0-rc1 --prerelease \
  --title "CipherChat v1.0.0-rc1" --notes-file RELEASE_NOTES.md
```

### Performance note

Room unlocking is deliberately slow (argon2id, 64 MB). On a desktop this
takes ~1 second; on a low-end Android it can take 5 to 8 seconds. That is
the cost of grinding resistance, not a bug. The sealing screen says so.

## Legal

- `LICENSE`: MIT
- `public/legal/terms.md`: Terms of Use (served in-app from the
  landing footer and Settings → About)
- `public/legal/privacy.md`: Privacy Policy (same)

## Reporting abuse

The architecture permits exactly one act of moderation: ending a
room. There is no content to review (the server is blind), no member
to suspend (identity is per-room and derived), no history to scrub
(none is stored). Reports are **graded by credibility** (see
`SECURITY.md` for the mechanics):

- **A member's report acts at once.** The report button in room
  settings signs `cc-report-v1` with the room's signing key. Members
  are the only humans who can see content, so they are the only
  credible content reporters.
- **A stranger's report needs corroboration.** Anonymous reports are
  tallied per room by distinct IP; three independent networks burn
  the room as the backstop.

Rooms can also be reported to **abuse@cipherchat.app** (also listed in
Settings → About). Self-hosters should publish their own contact and
keep the operator path (`POST /terminate` on the relay's internal
port, token-guarded) for the legal cases.

## Documentation

- `DESIGN.md`: tokens, motion, architecture, and the full threat model
- `COMPONENTS.md`: every component, its states and mechanics
- `worklog.md`: the build history, round by round

---

<div align="center">
  <img src="assets/footer.svg" width="880" alt="" />
</div>

## Author

**Okwuchukwu Ekene Don Davies**, *Izumi*

CipherChat was built as an IT project and is released under the MIT
License. It was designed and built end to end by Izumi. Claims are
checked against the code, and known limits are written down rather
than hidden.
