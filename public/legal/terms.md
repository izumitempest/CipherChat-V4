# CipherChat — Terms of Use

**Last updated: 2026-09-17**

These Terms of Use ("Terms") apply to the CipherChat software and to any
deployment of it that you use. By creating, joining, or otherwise using a
CipherChat room, you agree to these Terms. If you do not agree, do not use
CipherChat.

CipherChat is built around properties that are easy to state and important to
understand before you rely on it. These Terms assume you have also read the
published threat model in the repository (DESIGN.md), which describes in
plain language what CipherChat does and does not protect against.

---

## 1. What CipherChat is — and is not

1.1. CipherChat is free, open-source software for private, ephemeral
conversations. A conversation takes place in a "room" identified by a secret
link or room code and protected by a password that the participants choose.

1.2. There are no accounts, no email addresses, and no phone numbers. All
encryption keys are derived inside your browser, using a deliberately slow
key-derivation function (argon2id with 64 MB of memory). The server never
sees your password and has no way to recover it.

1.3. Messages and files are end-to-end encrypted (AES-256-GCM with uniform
padding), and every message is signed with a per-room key (ECDSA P-256).
Message history exists only in the memory of connected browsers. The server
stores no message or file content, at rest or in transit.

1.4. CipherChat is **not a service provider in the hosted sense**. The
authors publish source code and may operate a reference deployment, but any
deployment — including the reference deployment — is offered as-is, without
an operator that reads, moderates, backs up, or restores your data. If you
run your own deployment, Section 8 applies to you.

1.5. CipherChat is not an anonymity network. The relay component can observe
connection metadata (who connects, when, in which room, and roughly how
much encrypted traffic flows), even though it cannot read any content. See
the Privacy Policy and the threat model for the precise boundaries.

1.6. CipherChat is not certified for any regulated use — not for medical,
legal, financial, or governmental record-keeping — and no such fitness is
claimed.

## 2. Acceptance of these Terms

2.1. By using CipherChat you confirm that you have read, understood, and
agreed to these Terms and to the Privacy Policy.

2.2. If you use CipherChat on behalf of an organization, you confirm that you
are authorized to accept these Terms on its behalf.

2.3. Because there are no accounts, there is no click-through registration
and no identity verification. Acceptance is evidenced simply by your use.

## 3. Eligibility

3.1. CipherChat is not directed to children under 13. If you are under 13,
you may not use it.

3.2. If you are a minor in a jurisdiction where consent is required for
software like this, you may use CipherChat only with the consent of a parent
or legal guardian, and that guardian agrees to these Terms on your behalf.

3.3. You must have the legal right to use encryption software in your
jurisdiction (see Section 14).

## 4. No accounts, no recovery — your responsibility

4.1. A room exists as long as its link or room code and the password exist
somewhere. **If you lose the password, nobody can restore your access.**
There is no reset mechanism, no support contact that can let you back in,
and no backup. This is a deliberate property of the design, not an oversight.

4.2. Anyone who has the room link (or code) *and* the password can enter the
room. How you share them is your responsibility. Share the link and the
password through different channels.

4.3. The room password is immutable for the room's lifetime. Knowledge of
the password can never be revoked. When a member leaves, remaining members
re-key the room under a new key the leaver will not receive — but the
password itself does not change.

4.4. Refreshing the page locks you out of a room until you re-enter the
password, and members who join later see none of the history that came
before them. These are deliberate properties, not defects.

## 5. Acceptable use

You agree **not** to use CipherChat to:

- violate any applicable law;
- harass, threaten, defame, stalk, or incite violence against any person;
- distribute malware, or any content intended to compromise devices or
  networks;
- send spam or unsolicited bulk communications;
- interfere with any deployment's operation — including probing, scraping,
  or attempting to circumvent rate limits, overloading servers, or
  attacking the network connections of other members;
- impersonate another person or misrepresent your affiliation.

You further agree not to encourage or assist anyone else in doing so.

## 6. Content moderation under end-to-end encryption

6.1. CipherChat deployments are operated blind. The operator of a deployment
**cannot read, verify, edit, selectively delete, or otherwise moderate the
content of any room**, because the operator holds no keys. Unlawful use may
be technically invisible to the operator.

6.2. There is no in-app report button. A report could carry no evidence the
operator could independently verify, so a reporting mechanism would imply a
moderation capability that does not exist.

6.3. Responsibility for what happens inside a room rests with its members.
You choose whom you invite; verify identities with the tools the app gives
you (safety-number verification). If a room is used for something unlawful,
responsibility lies with the people who used it that way — not with the
authors of the software or the operator of a blind deployment.

## 7. Ephemeral by design — no warranty of destruction

7.1. Rooms are destroyed by "burning" — by their creator, or automatically
when their lifetime expires. Burning deletes the room's member registry
server-side. Messages carry optional per-message lifetimes. These mechanisms
are real, and they are irreversible.

7.2. **No warranty is made that content is destroyed on other people's
devices.** In particular:

- while a session is live, other members' browsers necessarily hold
  decrypted content in memory;
- **screenshots and photographs of the screen cannot be prevented** by any
  software;
- "view-once" messages and files are a client-side promise, not enforcement —
  a recipient can photograph the screen, and a technically capable recipient
  can passively retain decrypted content without ever opening the viewer.

7.3. Treat anything you send through CipherChat as potentially permanent.
Choose accordingly what you share, and with whom.

## 8. Self-hosting

8.1. CipherChat is licensed under the MIT License (see the LICENSE file).
You may run, study, modify, and redistribute it, including commercially,
subject to that license.

8.2. **If you operate a deployment, you are the operator** for the people
who use it. That means, among other things: you decide whether to offer
these Terms or publish your own; you are the contact your users can reach;
you are responsible for what your server logs and stores (see the Privacy
Policy for the complete inventory); and you are responsible for complying
with the laws that apply to you, including disclosure obligations you may
have.

8.3. The upstream project collects nothing from deployments it does not
operate, and has no technical capability to assist with, audit, or shut down
your deployment.

## 9. Intellectual property

9.1. The CipherChat source code is © CipherChat Contributors and licensed
under the MIT License. This document, the Privacy Policy, the DESIGN.md
threat model, and the project's documentation are part of that work.

9.2. **Your content remains yours.** No license is claimed over anything you
transmit through CipherChat. Nothing you create in a room is copied,
derived, or retained by the software other than as the relay function
technically requires — and the relay handles only ciphertext it cannot read.

## 10. Disclaimer of warranties

10.1. TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, CIPHERCHAT AND ANY
DEPLOYMENT OF IT ARE PROVIDED "AS IS" AND "AS AVAILABLE," WITHOUT WARRANTY
OF ANY KIND, EXPRESS, IMPLIED, OR STATUTORY, INCLUDING WITHOUT LIMITATION
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE,
NONINFRINGEMENT, ACCURACY, OR QUIET ENJOYMENT.

10.2. Without limiting the foregoing, no warranty is made that CipherChat
will be secure, error-free, uninterrupted, timely, or suitable for any
particular purpose, or that it will protect against any particular
adversary. The published threat model (DESIGN.md) describes the attacks
CipherChat is and is not designed to resist; you accept those boundaries by
using the software.

## 11. Limitation of liability

11.1. TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, NEITHER THE
AUTHORS NOR THE CONTRIBUTORS NOR THE OPERATOR OF ANY DEPLOYMENT WILL BE
LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR
PUNITIVE DAMAGES, OR FOR ANY LOSS OF PROFITS, DATA, PRIVACY, GOODWILL, OR
OTHER INTANGIBLE LOSSES, ARISING OUT OF OR RELATING TO YOUR USE OF (OR
INABILITY TO USE) CIPHERCHAT.

11.2. THE TOTAL AGGREGATE LIABILITY OF THE AUTHORS FOR ALL CLAIMS RELATING
TO CIPHERCHAT WILL NOT EXCEED THE AMOUNT YOU PAID FOR IT, WHICH IS ZERO.

## 12. Indemnification

12.1. To the maximum extent permitted by applicable law, you agree to
indemnify, defend, and hold harmless the authors, contributors, and (where
applicable) the operator of the deployment you use, from any claims,
damages, liabilities, and expenses (including reasonable legal fees) arising
out of your use of CipherChat or your violation of these Terms or of any
law.

## 13. Availability

13.1. There is no service-level agreement. Deployments — including the
reference deployment, if one is offered — are best effort.

13.2. Rooms depend on their server existing. A deployment may be slowed,
rate-limited, restarted, or discontinued at any time, and a discontinued
deployment takes its rooms with it. Because the server holds no content,
there is nothing to migrate and nothing to restore.

## 14. Export controls and encryption regulations

14.1. CipherChat contains strong encryption (AES-256, ECDSA P-256,
argon2id). Software of this kind may be subject to export and import
regulations in some jurisdictions, and to sanctions restrictions on
particular people, organizations, and places.

14.2. **It is your responsibility to comply with the laws that apply to
you**, including any that restrict your use, import, or export of encryption
software. The authors make no representation that CipherChat, or any
deployment of it, is legal to use, download, or access from your
jurisdiction.

## 15. Changes to these Terms

15.1. These Terms may be updated from time to time. The "Last updated" line
at the top always reflects the current version.

15.2. Because there are no accounts, there are no email addresses to notify
and no in-app delivery channel for legal updates beyond the documents
themselves. Your continued use of CipherChat after a change constitutes
acceptance of the updated Terms. If you operate a deployment and publish
your own terms, you are responsible for notifying your users in a way that
works for you.

## 16. Termination

16.1. You may stop using CipherChat at any time: burn your rooms, leave
them, and clear the site data in your browser. The Privacy Policy describes
exactly what each action deletes.

16.2. A deployment's operator may refuse service to anyone, and may modify
or discontinue the deployment at any time, with or without notice, to the
extent permitted by law.

16.3. Sections that by their nature should survive termination — including
Sections 9, 10, 11, 12, and 14 — survive it.

## 17. Governing law

17.1. These Terms are governed by the laws of **[Your Jurisdiction]**,
without regard to conflict-of-law rules.

17.2. The reference deployment, if offered, is provided as-is **without a
governing entity**: there is no operator organization behind it, no
registered contact, and no venue for disputes about it. If you use a
third-party deployment, or operate your own, that deployment's terms — and
the laws of the place it operates from — govern your use of it.

## 18. Contact

**Who to contact: the party operating the deployment you use.**

The party operating a self-hosted deployment is responsible for publishing
its own contact. The reference deployment publishes none, because it is
offered without a governing entity. For matters concerning the source code
itself, including these documents, see the repository, where the threat
model (DESIGN.md) is also published.
