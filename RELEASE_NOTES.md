# CipherChat v1.0.0-rc1

A conversation that leaves no trace.

CipherChat is an ephemeral, end-to-end-encrypted chat that runs in
your browser. A room is a link and a password. When you are done,
you burn it. There are no accounts, and no message history is stored
on any server.

This is the first release candidate. It is feature-complete and
tested, and its limits are listed below. The build history is in
CHANGES.md and is not repeated here. These notes are written for
strangers.

## What it is

Secure first contact. When you need a private channel right now,
with someone you can verify another way: share the link through one
channel, the password through another, and talk. The server relays
ciphertext it cannot read. Keys are derived and held in your browser
only.

- A room is a link and a password, both generated with a CSPRNG. The
  arithmetic is in DESIGN.md §5.
- Messages, files, reactions, and quoted replies are encrypted,
  signed, and padded to uniform sizes. The relay cannot tell typing
  from messages, or read file sizes.
- Message timers run from 5 seconds to 24 hours. Rooms can be set
  to expire, from minutes to 30 days, or to last until burned. Any
  member can burn the room for everyone.
- Photos are checked for EXIF metadata. If the metadata cannot be
  stripped, the photo is not sent.
- Keys rotate on every departure, to a new random key that is not
  derived from the password. A member who closes the tab without
  leaving is removed after two minutes, as long as anyone remains
  connected.
- PWA: installs from the browser, has an offline shell, and shows
  local notifications while the app is running.
- Self-hosting uses the same Docker Compose stack as the public
  deployment. Setup needs an access token and a hostname. See
  deploy/.

## What it isn't

- Not a Signal competitor. No accounts, no contact graph, no voice
  or video, no long-lived identity. It is a room, not a messenger.
- Not anonymous. The relay sees who talks to whom, when, and how
  much. Frame sizes are uniform, so file sizes and typing patterns
  are hidden, but the fact of communication is not.
- Not a vault. View-once is a promise between members, not
  enforcement. A member can keep what they decrypt. Signal has the
  same limit.
- Not for nation-state adversaries. If that is your opponent, use
  Signal or SimpleX.

## The limits

README.md has a section titled "What CipherChat does NOT protect
against," and it is unchanged for marketing. The short version: the
relay sees metadata. The room password cannot be changed, so
password knowledge is permanent, which is why rotation keys are
random and password-independent. Endpoint compromise reads
everything. Mobile notifications arrive only while the app is
running; MOBILE.md explains why, and what web push would cost.

Every security property in these notes is enforced by a named test,
and the product contract by the E2E golden path. The suite inventory
and count are in CHANGES.md. The security contract is in
SECURITY.md, the dependency-audit policy in AUDIT.md, and the threat
model in DESIGN.md §6.

## Verify it

```bash
bun install && bun run test    # the security property suite
bunx playwright test           # the E2E golden path (needs a dev
                               # stack; see README)
```

CI runs both on every push. The E2E job builds the production Docker
stack on the runner and drives the whole product through it: create,
join, message, reply, react, EXIF strip (byte-verified in the
receiver's viewer), view-once, leave, rotation, rejoin, burn.

## Reporting

- Vulnerabilities: see SECURITY.md. We aim to respond within 7 days.
  Credit is given in CHANGES.md if you want it. The project's whole
  history is there, including the rounds where the agent was wrong
  and said so.
- Abuse is graded in-app. A member's report ends the room at once. A
  stranger's report needs corroboration from three independent
  networks. The operator holds a token-guarded terminate for legal
  cases. The mechanics are in SECURITY.md.

## What "rc1" means

The code is feature-complete and the gates are green: lint, types,
property tests, E2E, dependency audit. What remains before v1.0.0 is
operational, not code: a domain, a Docker host, and a first
deployment of the Compose stack.

Every document in this repository follows one rule: claims are
checked against the code, and known limits are written down rather
than hidden.
