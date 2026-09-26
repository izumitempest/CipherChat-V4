# CipherChat: Privacy Policy

**Last updated: 2026-09-26**

This Privacy Policy explains what information exists, and what information
does not exist and cannot exist, when you use CipherChat. It is written to
match how the software actually behaves. Where the software has limits, this
policy states them plainly. The published threat model in the repository
(DESIGN.md) is the technical companion to this document.

---

## 1. The short version

- There are **no accounts, no email addresses, no phone numbers**. A room is
  a secret link or room code plus a password you choose.
- Your messages and files are **end-to-end encrypted**. The server cannot
  read them, and it stores none of them.
- The server is **blind by design**: it holds a small set of room metadata
  (listed in Section 3) and nothing else.
- Your browser's local storage holds your own convenience data (listed in
  Section 5). **Passwords and decrypted content are never written to disk.**
- There are **no analytics, no tracking cookies, no third parties, and no
  advertising** anywhere in CipherChat.
- You can delete everything: burn the room for the server side, clear site
  data for your device (Section 6).

## 2. The privacy architecture

2.1. All cryptography happens in your browser. When you create or enter a
room, your browser derives the room's encryption keys from your password
using argon2id, a memory-hard key-derivation function configured with 64 MB
of memory so that guessing passwords is expensive. **The server never sees
the password**, not even in hashed form.

2.2. Messages are encrypted with AES-256-GCM under uniform padding, so the
relay cannot tell a long message from a short one, or a message from a
typing indicator. Every message is signed with a per-room ECDSA P-256 key.

2.3. Message history exists only in the memory of connected browsers.
Refreshing the page locks you out until you re-enter the password; members
who join later see none of the history before them. The server stores no
message or file content at rest, ever.

2.4. Files are shared as encrypted frames relayed between live members, in
fixed 45-frame padded transfers, so the relay cannot read a file or learn
its size from the traffic.

2.5. Your identity inside a room (an alias and a color) is derived per-room
from a device seed that lives only in your browser's local storage. Two
rooms cannot be linked to each other through your public keys or aliases,
because each room sees different ones.

2.6. When you enter a password, your browser checks it against an encrypted
"verifier" blob stored on the room. The server cannot read that blob, and a
wrong password is detected without the server ever learning the right one.

## 3. Exactly what the server stores

A self-hostable CipherChat server stores, per room:

1. **The room id**: a random identifier, which appears in invite links as
   the room code.
2. **An encrypted "verifier" blob**: used to detect wrong passwords. The
   server cannot decrypt or read it.
3. **A creator token**: an unguessable value held by the room's creator,
   authorizing the burn action.
4. **A key-rotation epoch counter**: a number that advances when members
   leave, so everyone still in the room re-seals under new keys.
5. **A member registry**: for each member: an alias, a color, public keys,
   and join / last-seen timestamps.
6. **A burn timestamp and a report-reason note**, but only after a room has
   been ended through the reporting mechanism; the note is capped in length
   and exists for operator records.

That is the complete list. There is no separate profile, no contact
information, no content, and no backup of any of the above. Ending a room
by any of the paths in Section 6 deletes the member registry rows for that
room.

## 4. What never exists, anywhere

- **Message or file content at rest.** The server relays encrypted frames
  between live members and stores nothing; it has no database of messages,
  files, or attachments, and no backups of content.
- **Passwords.** They never leave your browser and are never written to
  disk. Nobody, whether a deployment operator or the project authors, can
  recover, reset, or read a room password.
- **Cross-room identities.** Because each room derives its own keypair from
  your device seed, the server cannot tell that two rooms share a member.
  There is no account to link them with.
- **Analytics, tracking cookies, third-party requests, advertising, or
  telemetry of any kind.** The app makes no requests to anyone except the
  deployment you are using.

## 5. What is stored on your device

CipherChat uses your browser's local storage to make the app usable between
visits. On your device, and only on your device, it holds:

- **Your device seed**: a random 32-byte value your browser uses to derive
  your per-room signing keys. It never leaves the device. (Devices that ran
  very old versions of the software may also still hold a retired device
  keypair in local storage; it is no longer used.)
- **Room cards**: for each room you've saved: the room code, an optional
  local nickname (a name only you see; others may call the room something
  else), and an unread-badge state.
- **Creator tokens for rooms you created**: the secret value that
  authorizes burning those rooms. Anyone with access to your browser profile
  could burn a room you created; treat device access accordingly.
- **Verification marks**: which members' fingerprints you have marked as
  verified, per room.
- **Drafts**: messages you started typing but have not sent.
- **Per-room replay-protection counters**: small sequence numbers that let
  your browser refuse replayed or duplicated frames.
- **Room settings**: your default message self-destruct timer for each room.
- **Theme preference**: daylight or nightfall.

**Passwords and decrypted message or file content are never written to
disk.** Decrypted content lives only in memory, and dies when the page
unloads or the room locks. The device seed above is the one exception to
"nothing secret is stored": it is what makes your per-room identity
recognizable after a refresh. Clearing your browser's site data deletes it
and everything else in this section, at the cost of your rooms no longer
recognizing you as the same member.

## 6. How to delete everything

- **The server side:** end the room. Rooms end by burning (by the creator),
  automatically at the end of the room's lifetime, through the member or
  corroborated-report mechanism (a member's signed report ends the room at
  once; three anonymous reports from distinct networks end it as a
  corroboration threshold), or by a deployment's operator. Every path
  destroys the room and deletes its member registry rows. None of them can
  be undone.
- **Your side:** use your browser's normal "clear site data" function for
  the deployment's origin. This removes the device seed, room cards,
  creator tokens, verification marks, drafts, counters, settings, and theme
  preference, which is everything in Section 5.
- **The limit:** deleting data from the server and your device cannot reach
  into other members' browsers or cameras. Content they decrypted during
  the session, screenshots they took, or photos of the screen are beyond
  any software's reach (see Section 10).

## 7. Operator logs

A deployment's relay prints join and leave lines to its standard output:
for each event, the member's alias, a partial member id, and the room code.
These lines exist so that an operator can keep the service running. They are
written to the server's console, not to a database, and what the operator
does with their own console output is the operator's responsibility as data
controller (Section 11).

There are no other logs. There is no analytics pipeline, no error reporting
service, and no request logging beyond what the hosting environment itself
may impose.

## 8. Rate limiting

To prevent abuse, the server keeps brief in-memory rate-limit counters per
IP address (for example, for room creation and for the report endpoint) and
per connection (for message framing). These counters exist only to shed
load, are not persisted, and are not correlated with any identity, because
there are no accounts to correlate them with.

## 9. Children's privacy

CipherChat is not directed to children under 13, and the authors do not
knowingly collect personal information from children under 13. No
registration information is collected from anyone: there are no accounts,
no contact fields, and no analytics. The only network-level data that
exists is the operational residue described in Sections 7 and 8 (operator
console lines and short-lived rate-limit counters keyed by IP address).
The Terms of Use set the eligibility rules.

## 10. Data security, and the known limits

The cryptography described in Section 2 is real and current. Security is a
floor, not a ceiling, and the following limits are documented rather than
hidden; see the published threat model in the repository (DESIGN.md) for
the full discussion:

- **A member who leaves silently may retain the room key until rotation
  completes.** Departure triggers re-keying, but the trigger is not
  instantaneous; a window of about two minutes exists between a silent
  disconnect and the rotation that seals the room again.
- **A fully malicious relay could attempt a narrow replay attack within
  roughly 10 minutes against a fresh device**, if no key rotation
  intervened. Replayed frames are refused within a device's memory and
  across refreshes; the limit applies only to a device that has never
  seen the room before.
- **The room membership cap (12) is a freshness-windowed soft cap**, not a
  hard architectural wall.
- **Screenshots cannot be prevented.** No software can stop a camera pointed
  at a screen.
- **View-once is a client-side promise, not enforcement.** A recipient can
  photograph the screen, and a technically capable recipient can passively
  retain decrypted content.
- **Endpoint compromise defeats everything.** A compromised device, whether
  by malware, a hostile browser extension, or physical access, reads what
  you read and types what you type. Nothing running in a browser can
  prevent this.
- **Metadata is visible to the relay.** Who connects, when, in which room,
  and roughly how much encrypted traffic flows: the fact and volume of
  communication is not hidden, even though the content and its shape are.

If any of these limits is unacceptable for your situation, do not use
CipherChat for that conversation.

## 11. Self-hosting: you are the data controller

The upstream project collects nothing: there is no telemetry, no
registration, and no call-home. When you self-host CipherChat, **you become
the data controller for your deployment**: the server-side inventory in
Section 3 lives on your infrastructure, the console lines in Section 7 are
printed on your machine, and the responsibilities of an operator under the
laws that apply to you (disclosure obligations, retention decisions,
jurisdictional rules) are yours. This document describes the software's
behavior; your own privacy policy should describe your practice of
operating it.

## 12. International transfers

Because there are no accounts and no registration information is collected,
the classic cross-border data-transfer question mostly does not arise. For
self-hosters it reverses direction: your participants connect from wherever
they are, to a server you run somewhere you chose. If you operate a
deployment, the transfer implications of your server's location, and of the
console output you keep, are part of your responsibilities as data
controller under Section 11.

## 13. Changes to this policy

This policy may be updated from time to time. The "Last updated" line at
the top always reflects the current version. Because there are no accounts,
there is no one to notify individually and no channel other than the
document itself; your continued use after a change constitutes acceptance.
If a future version of the software ever stores more than Section 3 lists,
this policy will say so explicitly.

## 14. Contact

14.1. **For matters concerning the software itself, including this policy
and the threat model: lilice308@gmail.com** (the author and maintainer).

14.2. If you use a deployment operated by someone else, contact that
deployment's operator. A self-hosted deployment is responsible for
publishing its own contact.
