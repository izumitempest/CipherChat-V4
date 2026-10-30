<div align="center">

<img src="assets/banner.svg" alt="CipherChat: a conversation that leaves no trace" width="880" />

<br />

<a href="https://readme-typing-svg.demolab.com"><img src="https://readme-typing-svg.demolab.com?font=Georgia&size=18&pause=1600&color=C85A40&center=true&vCenter=true&random=false&width=620&lines=A+room+is+a+link+and+a+password.;The+server+relays+ciphertext+it+cannot+read.;Keys+are+derived+and+held+in+your+browser.;No+accounts.+No+history.+No+trace.;Burn+it+when+you%27re+done." alt="CipherChat principles, one line at a time" width="620" /></a>

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
- **Ink marks.** Mark any message with one of four margin marks
  (✓ acknowledged · ✦ noted · ♥ warmly received · ☾ later). Marks are
  encrypted, signed, uniform-sized frames. The relay cannot tell
  a mark happened.
- **Captioned files.** Attach a file with words. The caption rides the
  file's meta frame, and the signature covers the whole frame body:
  the caption, the file's name, its type, its size and the ttl all
  ride inside it.
- **Refresh locks every room.** Keys live only in memory. Reload the page
  and each room must be unlocked again with its password.
- **Verifiable identity.** You are a derived alias and a fingerprint others
  can verify out-of-band. Your signing key is per-room: the same device
  in two rooms is two different, unlinkable identities.

## How the crypto works (protocol v3)

| Property | Mechanism |
| --- | --- |
| Room entry key | argon2id (64 MB, t=3, p=1) from the password + a random salt in a versioned key bundle (legacy PBKDF2 rooms still unlock) |
| Every frame | JSON → ECDSA-P256 signature over the **whole body** → **padded to a uniform size** → AES-256-GCM |
| Uniformity | All control frames (messages, typing, receipts, burns, key offers, file meta, ink marks) are the same size, so the relay cannot tell typing from a message. A file is padded to the smallest size bucket that holds it (64 KB, 256 KB, 1 MB, 2 MB), so the relay learns the bucket and not the file's exact size |
| Replay defense | per-sender monotonic counters, ±10-minute timestamp window, frame-id dedup, refresh-surviving watermarks |
| Rotation on leave | the remaining members switch to a **new random key**, delivered pairwise over ephemeral ECDH. The leaver is not sent it at rotation time, and it is not derived from the password |
| Silent-departure grace | a member whose connection drops without a clean leave is removed **2 minutes** later while anyone remains connected. The clock lives on the remaining clients: the relay's live presence (token-guarded, server-to-server) is the connection authority the eviction route consults, the epoch ledger makes the rotation durable, and the departed member simply re-enters with the password when they return |
| Departure proof | leaving requires a signature from the member's registered key. A room-code holder cannot trigger nuisance rotations in your name |
| Rejoin after rotation | the current key arrives ECDH-wrapped and encrypted under the password-derived entry key, so only a joiner who proved the password can open it. A password holder who comes back gets the current key like anyone else |
| Joining proves the password | the server keeps a join verifier, an HMAC over the key derivation output bound to the room, and never publishes it. The client proves knowledge with a fresh HMAC, so a link holder can read nobody's roster and register nobody |
| Forgery | messages are signed inside the encrypted payload and verified against the REST member registry; forgeries render as a plain rejection line |
| Verifiability | fingerprints derive from registered public keys; verification marks live on your device |

The constants behind these rows (KDF parameters, replay windows, the
120-second grace clock) live in `src/lib/` (`identity.ts`,
`protocol.ts`, `silent-grace.ts`), and every one is enforced by a
property test.

The full property suite is enforced by tests named after the properties
they protect: replay, rotation, padding, KDF, identity, hardening,
silent-departure grace, departure proofs, admission, reply integrity,
canonical collision-proofing, the join proof, the creator token, the
file chunk shape, the relay's member binding, the trust boundaries of
the API routes, passphrase CSPRNG source.
The per-round inventory and the current count live in `CHANGES.md`
(this section does not restate them; duplicated counts
go stale). Run the suite with `bun run test`.

## What CipherChat does NOT protect against

Read this part. These are the main limitations.

- **Metadata.** The relay sees who talks to whom, when, and how much.
  Frame sizes are uniform, so it cannot distinguish typing from
  messages, and a file's size is hidden inside a bucket, but the fact
  of communication is visible and the bucket is not.
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
  knowledge is permanent. That is why rotation keys are random
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

### Development (one command)

`start-dev.sh` at the repository root starts the whole stack, one
terminal:

```bash
./start-dev.sh            # web on :3000, relay on :3003, presence on :3004
./start-dev.sh --lan      # the same, plus two https tunnels for a phone
./start-dev.sh status     # are the services up?
./start-dev.sh stop       # stop everything the script knows about
./start-dev.sh restart    # stop, then start
```

`scripts/dev.sh` still exists and forwards to it, so the old command
keeps working.

What it does:

- Fills in any missing variable in `.env` (never overwrites an existing
  one): `RELAY_INTERNAL_TOKEN` as 48 random hex, the database path, the
  relay URL and the site URL.
- Generates the Prisma client and applies the migrations, so the
  database is the right shape before the app talks to it.
- Stops anything already sitting on 3000, 3003 or 3004, so a stale
  instance never answers in your place.
- Starts the relay and the web app detached, so they survive the
  terminal closing. Logs land in `dev.log` and `relay-dev.log`, the
  pids in `.run/`.
- Waits until all three ports answer, then prints where to go.

With `--lan` it also opens two Cloudflare quick tunnels, one for the app
and one for the relay, and writes the relay's tunnel URL into `.env`
before the web app starts. Plain http on a LAN address is not a secure
context, and WebCrypto needs one, so a phone cannot join over the LAN
address itself.

The relay URL is configuration, not code: `NEXT_PUBLIC_RELAY_URL`
(dev: absolute `http://localhost:3003/`; production: same-origin
`/relay/`, which Caddy forwards to the relay per `deploy/Caddyfile`).
Every variable is documented in `.env.example` (root, dev) and
`deploy/.env.example` (production).

### Production: one plain VPS

```bash
cd deploy
cp .env.example .env        # set RELAY_INTERNAL_TOKEN (openssl rand -hex 24)
                            # and CADDY_SITE (your domain, or localhost for testing)
docker compose up -d        # app + relay + Caddy with automatic TLS
```

That is the whole self-host setup: `deploy/` contains the web Dockerfile
(Next.js standalone output + Prisma), the relay Dockerfile, and the
compose file that wires them behind Caddy. The compose file runs the
migrations before the app starts, so the schema is right without a
manual step. `docker compose down -v` removes the database volume too.
Burn your rooms first if you mean it.

On a machine with only Docker installed, `docker compose up` gives a
working HTTPS site; verify the golden path with **two devices** (two
origins, not two tabs; tabs share localStorage): create, join, message,
rotate-on-leave, rejoin, file, view-once, burn.

### Share a local deployment on the internet (Cloudflare quick tunnel)

Want someone on the internet inside a room right now without buying a
VPS? `deploy/share.sh` runs the production compose stack and puts a
Cloudflare quick tunnel in front of it:

```bash
deploy/share.sh            # build, start, verify health, print the link
deploy/share.sh status     # services + live URL
deploy/share.sh url        # just the URL
deploy/share.sh down       # stop the tunnel and stack (keeps the database)
deploy/share.sh down wipe  # also removes the database volume
```

It takes a fresh `RELAY_INTERNAL_TOKEN`, defaults `CADDY_SITE=http://localhost`
on the first-run `.env` it creates so Caddy serves plain HTTP on :80 (the
tunnel's edge does TLS for you), waits
for the web tier to pass the DB-backed 404 probe and for the relay to answer
an engine.io handshake through Caddy's `/relay/` route, then starts a
cloudflared quick tunnel. One URL serves the app and the relay because the
compose's Caddyfile routes `/relay/*` to the relay and everything else to the
web app on the same edge.

Quick tunnels pick a new random hostname on every run and die with the
process. For a stable public address, do the one-time account setup
(`cloudflared tunnel login` + a named tunnel sending your hostname to
`http://localhost:80`), then run `SHARE_TUNNEL_MODE=named deploy/share.sh`
with `CF_TUNNEL_NAME` set. `deploy/TOR.md` is the sibling recipe for a
.onion address.

### E2E: the golden path, automated

`tests/e2e/golden-path.spec.ts` (Playwright) drives the whole product
through one conversation with **two browser contexts** (same origin,
isolated storage), which removes the two-origins trick manual QA needed:
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
  property suite → the dependency audit → the migrations → the
  production build. The audit is split by scope: the **runtime tree**
  gate is blocking (exceptions enumerated per advisory in
  `scripts/audit-gate.mjs` + `AUDIT.md`), the full-tree view is
  advisory and dispositioned per advisory.
- **e2e**: builds the production compose stack on the runner (web +
  relay + Caddy), waits for it to answer, and drives the golden path
  through it; traces, screenshots, and stack logs upload on failure.

Red means no merge. The property suite is the security contract, and
the golden path is the product contract.

### Releases

Pushing a tag (`v*`) fires `.github/workflows/release.yml`: the
property suite runs first, then a GitHub release is created from
`RELEASE_NOTES.md`. A red suite means no release, the same rule as
in CI. Tags containing a hyphen (rc, beta) are marked prerelease
automatically. If you would rather create a release without the
workflow:

```bash
gh release create v1.0.0-rc1 --prerelease \
  --title "CipherChat v1.0.0-rc1" --notes-file RELEASE_NOTES.md
```

### Performance note

Room unlocking is slow by design (argon2id, 64 MB). On a desktop this
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
(none is stored). There is no report button in the app and no report
endpoint on the server, because the only act a report could trigger
was ending the room, and every path to that act was reachable by
anyone holding an invite link.

A graded report looked safer because it had to carry a signature from
a registered key, but registering took no proof of anything, so a link
holder could register and then burn. The anonymous version was worse:
three distinct IPs counted, the tally lived in memory, and the server
kept a reporter's free text for seven days against the nothing-stored
promise. Grading bought the shape of moderation without the
substance, so the feature went.

A room ends three ways: its clock runs out, the creator burns it, or
the operator terminates it. The creator holds the burn button. The
operator holds a token-guarded `POST /terminate` on the relay's
internal port for the legal cases.

Rooms can also be reported to **lilice308@gmail.com** (also listed in
Settings → About). Self-hosters should publish their own contact and
keep the operator path for the legal cases. The mechanics are in
`SECURITY.md`.

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
