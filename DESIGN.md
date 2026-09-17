# CipherChat — Design Documentation

*Warm paper and deep forest. A letter you'd trust, not a terminal you'd fear.*

---

## 1. Complete Token Sheet

### Color — "Daylight desk" (light, default)

| Token | Value | Usage |
|---|---|---|
| `--paper` | `#F4F1EB` | Canvas |
| `--side` | `#EBE7DF` | Raised surfaces, sidebar, cards, others' bubbles |
| `--charcoal` | `#2C2A28` | Primary text |
| `--mute` | `rgba(44,42,40,0.6)` | Secondary text, metadata, timestamps |
| `--wash` | `rgba(58,79,65,0.07)` | Hover fill on quiet surfaces |
| `--forest` | `#3A4F41` | Primary actions, secure states, identity accents |
| `--forest-deep` | `#2B3D31` | Hover/pressed forest |
| `--terracotta` | `#C85A40` | Destructive + impermanent ONLY: burn, TTL, terminate, view-once |
| `--terracotta-deep` | `#A8492F` | Hover/pressed terracotta |
| `--ember` | `#E8A87C` | Burn glow edge — motion only, never static |
| `--ash` | `#B7B2A8` | Burned-room card state |
| `--hairline` | `rgba(44,42,40,0.08)` | 1px borders |
| `--ink-0 … --ink-7` | 8 muted stationery inks | Deterministic member identity (dot + alias) |

### Color — "Nightfall" (dark: the same desk by lamplight)

| Token | Value |
|---|---|
| `--paper` | `#17181A` |
| `--side` | `#212226` |
| `--charcoal` | `#F4F1EB` |
| `--mute` | `rgba(244,241,235,0.58)` |
| `--wash` | `rgba(116,148,128,0.09)` |
| `--forest` | `#4A6453` |
| `--forest-deep` | `#5B7A66` |
| `--terracotta` | `#E0745D` |
| `--terracotta-deep` | `#EA8A74` |
| `--ember` | `#EAB489` |
| `--ash` | `#6E6A63` |
| `--hairline` | `rgba(244,241,235,0.09)` |
| inks | lightened ≈ +20% for contrast on dark paper |

*Rationale: Nightfall is not an inversion — large surfaces stay muted and warm; only text and accents carry energy. All text meets ≥4.5:1.*

### Typography

| Role | Font | Size/Line | Class |
|---|---|---|---|
| Display (landing, burn line) | Lora 600 | 30/36 | `.t-display` |
| Screen title | Lora 600 | 20/28 | `.t-title` |
| Message body | Lora 400 | 15.5/1.5 | `.t-body` |
| UI labels/buttons | Inter 500 | 13–14, +0.01em | `.t-label` |
| Metadata/timestamps | Inter 400 | 11, +0.01em | `.t-meta` |
| Key fingerprints | IBM Plex Mono | 15, grouped `3F2A · 91BC`, select-all | `.t-fingerprint` |

### Shape, space, materials

- 4pt spacing grid. Message stacks: **4px inner, 12px between sender groups**; consecutive messages within 3 minutes collapse timestamps (last-of-group shows time; every TTL message also shows its own remaining life).
- Radii: **4** chips · **8** inputs · **12** buttons/cards · **18** bubbles, corner nearest sender reduced to **6**.
- Touch targets ≥ 44px; primary buttons 48px.
- Materials: cards = `side` + hairline, **no shadow**. Only the composer and dialogs blur + `0 1px 2px @8%` shadow. Paper grain: ~2.5–3% noise overlay on the whole canvas (5% soft-light in Nightfall).
- Bubbles max-width 75%; self right-aligned (forest wash), others left-aligned with ink dot + alias.
- Layout: mobile-first single column; desktop = 320px desk sidebar + chat column ≤720px centered. PWA manifest + icons included.

---

## 2. Component Inventory

| Component | States |
|---|---|
| **PrimaryAction** | default / hover(forest-deep) / busy(spinner) / disabled — 48px, radius 12 |
| **SecondaryAction** | default / hover(wash) / busy / disabled |
| **DestructiveAction** | default / hover(deep) / busy — terracotta, burn contexts only |
| **QuietAction** | default / hover — mute→charcoal text action |
| **Field / TextField / PasswordField** | default / focus(forest ring) / error (neutral charcoal inline text — errors never carry color) / disabled |
| **MonoValue** | resting / copied |
| **RoomCard** | normal (paper lift hover) / locked (lock glyph, muted) / unread (forest dot) / **burned** (ash, quiet strikethrough, one session then swept) |
| **UnlockSheet** | default / wrong-password / unlocking (→ S3) |
| **MessageBubble** | sending (60% opacity) / sent / grouped (corner rules, collapsed time) / TTL (hourglass + live countdown, terracotta 60%) / **burning** (ember edge → char → dissolve 600ms) |
| **FileCard** | image (inline thumbnail) / file (icon + name + size + download) / **sealed** (view-once) / **spent** (ember edge, non-reopenable) |
| **SystemLine** | join / return / leave+rotate / forged-message rejection — quiet centered sans |
| **Composer** | default / composing (auto-grow 1–3 lines) / attaching (slip + view-once toggle) / TTL armed (chip cycles OFF→5m→1h→8h) / **reconnecting** (send replaced by status) / re-sealing / room-full |
| **SealingOverlay (S3)** | arc fill 1.7s + seal press; reduced-motion: static + 150ms fades |
| **BurnOverlay (S6)** | char (2s inward) → Lora line (400ms) → hold → fade (400ms) |
| **VerificationSheet (S7)** | per-member row: ink dot + alias + grouped fingerprint + copy + user-set verified check; one-tap glossary |
| **SettingsSheet (S9)** | local name (private-to-you note) / default-TTL segmented / member list / burn (creator) or leave (guest) — separated by whitespace, never adjacent |
| **InviteSheet** | link copy / password show+copy / different-channels guidance |
| **FileViewer** | image contained / file download; view-once spends on open |
| **ThemeToggle** | daylight ⇄ nightfall (CSS-driven icons, no hydration guesswork) |
| **SealMark** | static / breathing (the app's single idle loop, landing only) |

---

## 3. Motion Spec

Standard easing: `cubic-bezier(0.2, 0, 0, 1)`. Durations: 150 state / 250 entrance / 400 overlay / 600 burn. **Nothing loops infinitely except the landing seal's 6s breath.**

| Trigger | Duration | Easing | Reduced-motion fallback |
|---|---|---|---|
| Button/hover/focus state | 150ms | standard | n/a (instant) |
| Card settle (lists, sheets content) | 250ms | standard | 150ms fade |
| Message send (rise) | 250ms | standard + slight rise | 150ms fade |
| Sheet in/out (bottom mobile, right desktop) | 400ms | standard | 150ms fade |
| S3 seal arc + press | 1700ms + 1740ms | standard | 150ms fade (arc completes instantly) |
| **Message TTL burn** | 600ms | standard | **150ms opacity fade** |
| **Room burn: char inward** | 2000ms | standard | 150ms fade to final state |
| Room burn: Lora line in | 400ms | standard | 150ms fade |
| Room burn: overlay out | 400ms | standard | 150ms fade |
| "Reconnecting…" dot pulse | 1.6s × 3, then rests | ease-in-out | static |
| Landing seal breath | 6s infinite | ease-in-out | disabled |

---

## 4. Rationale — one line per non-obvious decision

- **Room keys live only in memory.** Refresh-locking isn't simulated — keys genuinely die, so the locked state is a fact, not a screensaver.
- **PBKDF2 at 750k iterations** rather than a token spinner: the S3 wait is real work; the theater merely refuses to finish before the vault does.
- **Verifier blob (encrypted known plaintext)** lets joiners detect wrong passwords without the server ever learning the password or a hash of it.
- **Identity inks are muted stationery tones** — distinguishable at a glance, yet none reads as an accent color; forest and terracotta keep their exclusive meanings.
- **The signature lives inside the ciphertext**, so a malicious relay cannot strip or swap it invisibly; registry pubkeys make forged senders detectable ("A message claiming to be from … was rejected").
- **Errors are neutral charcoal** — terracotta means impermanence, not failure; wrong-password is a fact, not a danger.
- **The composer's send slot becomes "Reconnecting… / Re-sealing…"** — the one input that can never silently accept text into a void.
- **Ash cards persist for exactly one session** — the destruction deserves a witness; the next page load sweeps the desk.
- **Creator's empty room shows the invite verb** ("Copy invite link"), the joiner's shows the product statement ("You won't see messages from before you joined. That's how this works.") — two honest empties, not one apology.
- **The burn is the only centered modal** ("This destroys the room and its messages for everyone. This cannot be undone.") because it is the only irreversible act.
- **The sidebar's "New room" is a quiet icon** so no screen ever carries two primary greens.
- **Local room names are never corrected** — two people may call the same room different things; the label is yours alone.
- **Unread is a 6px forest dot** — quiet by policy; no counts, no badges, no streaks.

---

## 5. Architecture (for the record — protocol v2, Task 19)

- **Client** (`/`, hash-routed `#/`, `#/new`, `#/join/:id`, `#/rooms`, `#/r/:id`): all crypto in WebCrypto + hash-wasm + @noble/curves.
  - **Entry key (kv 1)**: argon2id (m=64 MB, t=3, p=1) from the room password and a random 16-byte salt carried in a **versioned key bundle** (`{v:2, alg:"argon2id", ...}`) stored on the room. Rooms created before the upgrade (versionless PBKDF2-SHA256/750k bundles) still unlock through the legacy path.
  - **Wire protocol v2** (`src/lib/protocol.ts`): every frame is `body JSON → sign (ECDSA P-256, canonical v2) → pad to a fixed size → AES-256-GCM`. Control frames (text, typing, receipts, burns, key offers, file metadata) are uniformly **20480+16 bytes**; file transfers are **exactly 45 uniform frames** (1 meta + 44 chunks of 65536+16, payload padded to a fixed 2,800,000 base64 characters) regardless of true file size — the relay cannot distinguish typing from messages or read file sizes.
  - **Replay defense**: per-sender monotonic counters inside a per-page-load session tag, a ±10-minute timestamp window, frame-id dedup, and watermarks persisted per room per device (survive refresh).
  - **Identity**: one random device seed; each room derives its own ECDSA P-256 signing key via HKDF(seed, roomId) — same device, two rooms → different pubkeys and aliases, so registries cannot be correlated. Session ECDH P-256 pairs regenerate every page load (memory only).
  - **Key rotation** (`src/lib/room-protocol.ts`): when a member leaves, the deterministic coordinator (lowest memberId among connected members) generates a **random** key — never derived from the password — and delivers it pairwise over authenticated ECDH, signed, sealed under the entry key so every member can read the offer but only the recipient can unwrap it. Departed members are evicted from local registries; their frames are refused. The server's room epoch is a persistent rotation ledger: rejoiners past it re-seal past any key a departed member may still hold, and unanswered key requests self-heal through version-randomized fallback rotations that converge monotonically.
  - **Join delivery**: a member re-joining after a rotation receives the current key as an ECDH-wrapped offer additionally sealed under the entry key — only a joiner who proved the password can open it.
- **Server** (Next.js API routes + Prisma/SQLite): room lifecycle, member registry (**the only identity authority** — keyed by pubkey, so a forged relay join cannot overwrite a real member), creator-token-authorized burn, epoch ledger bump on leave. **Never sees plaintext or passwords; stores no messages.** Room creation is rate-limited to 5/minute/IP.
- **Relay** (socket.io mini-service, :3003, in-memory): blind uniform-frame forwarding, presence, key requests. Token-bucket rate limit (20 frames/sec sustained, burst 64) per socket; oversized frames are a protocol violation and hard-disconnect; at most 16 rooms per socket. No DB, no history — new joiners see nothing from before they joined, by construction.

## 6. Threat model — what this does NOT protect against

Honest claims only; this list is the product's spine.

- **Metadata.** The relay sees who talks to whom, when, room ids, frame counts, and presence. Frames are size-uniform, so content *type* (message vs typing) and file *sizes* are hidden — but the fact and volume of communication is not.
- **View-once is a UI promise, not enforcement.** Any member can passively decrypt a view-once file on receipt and keep it, without ever opening the viewer. This is inherent to group E2EE (Signal has the same limit).
- **Silent leavers — bounded by the grace.** Rotation fires when a member *announces* departure, and since round 21 also when they silently vanish: every remaining client starts a 2-minute grace clock on the disconnect, and the connected coordinator (smallest memberId among live members) asks `POST /api/rooms/:id/evict` to write them out and bump the epoch — the rotation ledger. The route fails closed: it consults the relay's live presence snapshot (token-guarded, server-to-server on an internal port) as the connection authority, requires the caller to be live and the target offline for at least a minute. The residual is the 2-minute window itself — and for a hostile exit, burn the room. A nuisance-evicter who knows only the roomId can force a rotation while someone is away; the departed member simply re-enters with the password (same accepted-risk class as insider nuisance-rotations).
- **Insiders can always sabotage.** Any current member can push a nuisance rotation, leave garbage, or publish the room key out-of-band. Group E2EE cannot defend against a malicious participant — it only keeps outsiders out.
- **The room password is immutable** for the room's lifetime (the verifier is set once at creation). Password knowledge can never be revoked; rotations exist precisely so the key stops depending on it.
- **Endpoint compromise.** A compromised device (XSS, malware, physical access) reads everything and impersonates the user. Nothing in the browser can prevent this.
- **The relay and REST API are unauthenticated at the transport layer** (by design — no accounts). Forged relay joins cannot poison identity (REST registry is authoritative, keyed by pubkey) and forged leaves cannot force rotations (confirmed against REST first) — but they can appear as transient presence noise.
- **Replay residuals.** Replayed frames are refused within a device's memory and across refreshes (persisted watermarks) — but a frame captured within the ±10-minute window can be delivered *once* to a device that has never seen the room before (e.g., a fresh joiner on a new device). No history is stored anywhere; this is the residual cost of not trusting the relay with sequence numbers.
- **Not a nation-state adversary.** If your opponent is one, use Signal or SimpleX.
