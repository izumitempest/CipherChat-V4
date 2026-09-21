# CipherChat v1.0.0-rc1 — release notes

A conversation that leaves no trace.

CipherChat is an ephemeral, end-to-end-encrypted chat room that lives
entirely in your browser. No accounts, no history on any server, no
install — a room is a link and a password, and when you're done, you
burn it.

This is the first release candidate: feature-complete, tested, and
documented — including its limits, which are listed below with the same
care as the features. These notes are written for strangers; the
build history and per-round receipts live in `CHANGES.md`, and none of
it is repeated here.

## What it is

**Secure first contact.** When you need a private channel right now,
with someone you'll verify another way: share the link through one
channel, the password through another, and talk. The server relays
ciphertext it cannot read; keys are derived and held in your browser
only.

- Rooms are a link and a password (CSPRNG-generated — see
  `DESIGN.md` §5 for the arithmetic)
- Messages, files, reactions, quoted replies — encrypted, signed, and
  padded to uniform sizes: the relay cannot tell typing from messages,
  or read file sizes
- Messages can carry a TTL (presets from seconds to hours, custom up
  to a day); rooms have lifetimes; anyone can burn a room for
  everyone
- Images pass a fail-closed EXIF strip — location metadata that
  cannot be stripped does not get sent
- Keys rotate on every departure, to a fresh random key that is never
  derived from the password; a silent leaver (tab closed) is written
  out after a bounded grace while anyone remains connected
- PWA: installs from the browser, offline shell, local notifications
  while the app is alive
- Self-host in one command: `docker compose up` (see `deploy/`)

## What it isn't

- **Not a Signal competitor.** No accounts, no contact graph, no
  voice or video, no long-lived identity. It is a room, not a
  messenger.
- **Not anonymous.** The relay sees who talks to whom, when, and how
  much. Frame sizes are uniform; the fact of communication is not
  hidden.
- **Not a vault.** View-once is a promise between members, not
  enforcement — any member can passively keep what arrives. Insiders
  can always sabotage a group they are inside.
- **Not for nation-state adversaries.** If that is your opponent, use
  Signal or SimpleX.

## The honest limits

`README.md` has a section titled "What CipherChat does NOT protect
against" — read it; it is the product's spine and it is unchanged for
marketing. The short version: metadata is visible to the relay; the
room password cannot be changed, so password knowledge is permanent
(which is exactly why rotation keys are random and
password-independent); endpoint compromise reads everything; mobile
notifications arrive only while the app is running (`MOBILE.md` says
why, and what web push would cost).

Every claim in these notes is backed by a named property test — the
suite's inventory and count live in `CHANGES.md` — and the security
contract is written down in `SECURITY.md`, the dependency-audit policy
in `AUDIT.md`, the full threat model in `DESIGN.md` §6.

## Verify it

```bash
bun install && bun run test    # the security property suite
bunx playwright test           # the E2E golden path (needs a dev stack — see README)
```

CI runs both on every push, and the E2E job does not cheat: it builds
the production Docker stack on the runner and drives the whole product
through it — create → join → message → reply → react → EXIF strip
(byte-verified in the receiver's viewer) → view-once → leave →
rotation → rejoin → burn.

## Reporting

- **Vulnerabilities** — `SECURITY.md`. We target a first response
  within 7 days, and credit in `CHANGES.md` if you want it (the
  project's whole history is there, including the rounds where the
  agent was wrong and said so).
- **Abuse** — graded, in-app: a member's report ends the room at once;
  a stranger's report needs corroboration from three independent
  networks; the operator holds a token-guarded terminate for the
  legal cases. The mechanics are in `SECURITY.md`.

## What "rc1" means

The code is feature-complete and the gates are green — lint, types,
property tests, E2E, dependency audit. What remains before v1.0.0 is
operational, not code: a domain, a Docker host, and a first real
deployment proving the compose stack in production.

---

*Every document in this repository follows one rule: claims are
checked against truth, and the residuals are written down rather than
hidden. These notes are no exception.*
