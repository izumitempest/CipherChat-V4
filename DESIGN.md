# CipherChat: Design Documentation

*Warm paper and deep forest.*

---

## 1. Complete Token Sheet

### Color: "Daylight desk" (light, default)

| Token | Value | Usage |
|---|---|---|
| `--paper` | `#F4F1EB` | Canvas |
| `--side` | `#EBE7DF` | Raised surfaces, sidebar, cards, others' bubbles |
| `--charcoal` | `#2C2A28` | Primary text |
| `--mute` | `rgba(44,42,40,0.6)` | Secondary text, metadata, timestamps |
| `--wash` | `rgba(58,79,65,0.07)` | Hover fill on low-emphasis surfaces |
| `--forest` | `#3A4F41` | Primary actions, secure states, identity accents |
| `--forest-deep` | `#2B3D31` | Hover/pressed forest |
| `--terracotta` | `#C85A40` | Destructive + impermanent ONLY: burn, TTL, terminate, view-once |
| `--terracotta-deep` | `#A8492F` | Hover/pressed terracotta |
| `--ember` | `#E8A87C` | Burn glow edge, motion only, never static |
| `--ash` | `#B7B2A8` | Burned-room card state |
| `--hairline` | `rgba(44,42,40,0.08)` | 1px borders |
| `--ink-0 … --ink-7` | 8 muted stationery inks | Deterministic member identity (dot + alias) |

### Color: "Nightfall" (dark theme)

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

*Rationale: Nightfall is not an inversion. Large surfaces stay muted and warm; only text and accents are bright. All text meets ≥4.5:1.*

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
| **PrimaryAction** | default / hover(forest-deep) / busy(spinner) / disabled: 48px, radius 12 |
| **SecondaryAction** | default / hover(wash) / busy / disabled |
| **DestructiveAction** | default / hover(deep) / busy: terracotta, burn contexts only |
| **QuietAction** | default / hover: mute→charcoal text action |
| **Field / TextField / PasswordField** | default / focus(forest ring) / error (neutral charcoal inline text, errors never carry color) / disabled |
| **MonoValue** | resting / copied |
| **RoomCard** | normal (paper lift hover) / locked (lock glyph, muted) / unread (forest dot) / **burned** (ash, low-contrast strikethrough, kept one session then cleared) |
| **UnlockSheet** | default / wrong-password / unlocking (→ S3) |
| **MessageBubble** | sending (60% opacity) / sent / grouped (corner rules, collapsed time) / **quoted reply** (quote block edged in the quoted sender's ink, jump-to-original with the soft forest flash) / TTL (hourglass + live countdown, terracotta 60%) / **burning** (ember edge → char → dissolve 600ms) |
| **FileCard** | image (inline thumbnail) / video · audio · file (kind glyph + label + eye, **opens the viewer**; downloading lives inside the viewer, never on the card) / **sealed** (view-once) / **spent** (ember edge, non-reopenable) |
| **SystemLine** | join / return / leave+rotate / forged-message rejection: low-contrast centered sans |
| **Composer** | default / composing (auto-grow 1–3 lines) / attaching (slip + view-once toggle) / **replying** (quote slip above the input; Escape releases the quote before anything else) / TTL armed (chip cycles OFF→5m→1h→8h) / **reconnecting** (send replaced by status) / re-sealing / room-full |
| **SealingOverlay (S3)** | arc fill 1.7s + seal press; reduced-motion: static + 150ms fades |
| **BurnOverlay (S6)** | char (2s inward) → Lora line (400ms) → hold → fade (400ms) |
| **VerificationSheet (S7)** | per-member row: ink dot + alias + grouped fingerprint + copy + user-set verified check; one-tap glossary |
| **SettingsSheet (S9)** | local name (private-to-you note) / default-TTL segmented / member list / burn (creator) or leave (guest), separated by whitespace, never adjacent |
| **InviteSheet** | link copy / password show+copy / different-channels guidance |
| **FileViewer** | image zoom / video / audio / **PDF on canvas** (no toolbar, no save button) / text · CSV table / hex dump: every file opens in-app; view-once spends on open and **has no download anywhere** |
| **ThemeToggle** | daylight ⇄ nightfall (CSS-driven icons, no hydration guesswork; the switch swings the new icon in, `theme-turn`) |
| **InkMark** | static / breathing (landing) / **landing choreography** (fall → squash → splash → halo) / **ghost draw-on** (watermarks) / scattered (burn) / fleck (identity) |

---

## 3. Motion Spec

Standard easing: `cubic-bezier(0.2, 0, 0, 1)`. Durations: 150 state / 250 entrance / 400 overlay / 600 burn. **Nothing loops infinitely except the landing mark's breath/evaporation, the typing whisper, the watermark drift, and final-countdown pulses, all low-amplitude, all reduced-motion-off.**

| Trigger | Duration | Easing | Reduced-motion fallback |
|---|---|---|---|
| Button/hover/focus state | 150ms | standard | n/a (instant) |
| Card settle (lists, sheets content) | 250ms | standard | 150ms fade |
| **Screen/route entrance (`screen-in`)** | 280ms | standard + 10px rise | 150ms fade |
| **Message in: self (`msg-in-self`)** | 260ms | from the right margin, one overshoot | 150ms fade |
| **Message in: others (`msg-in-other`)** | 260ms | from the left margin | 150ms fade |
| **Quote flash (`quote-flash`)** | 1300ms, once | a soft ring of forest pulses twice, then fades (recognition, not alarm) | static 8% forest tint |
| Sheet in/out (bottom mobile, right desktop) | 400ms | standard | 150ms fade |
| S3 seal arc + press | 1700ms + 1740ms | standard | 150ms fade (arc completes instantly) |
| **Hero landing: drop falls (`drop-land`)** | 580ms | gravity in, spring out; squash at impact | 150ms fade |
| **Hero landing: flecks splash (`fleck-splash`)** | 460ms, +240ms | stacked on the evaporation loop via independent `translate`/`scale` | disabled |
| **Hero landing: ink halo (`halo-bleed`)** | 800ms, +260ms | stain spreads under the drop | 150ms fade, no delay |
| **Hero hover: flecks lift, ember flares** | 450ms transition | independent properties again | instant |
| **Typing whisper (`whisper-fleck`)** | 1.15s infinite, 3 flecks staggered | rise + fade | static at 55% |
| **TTL final 10s (`ttl-final`)** | 1s infinite pulse | ease-in-out | disabled |
| **Send burst (`send-fleck`)** | 520ms, two pseudo-flecks | standard | 150ms fade |
| **Ghost watermark draw-on (`ghost-draw`)** | 1300ms + fleck fades | pathLength dash | 150ms draw |
| **Ghost watermark drift (`ghost-drift`)** | 13s infinite, 1.6s delayed | ±6px translate | disabled |
| **Theme turn (`theme-turn`)** | 420ms | −80° swing in | 150ms fade |
| **Message TTL burn** | 600ms | standard | **150ms opacity fade** |
| **Room burn: char inward** | 2000ms | standard | 150ms fade to final state |
| Room burn: Lora line in | 400ms | standard | 150ms fade |
| Room burn: overlay out | 400ms | standard | 150ms fade |
| "Reconnecting…" dot pulse | 1.6s × 3, then rests | ease-in-out | static |
| Landing mark breath + evaporation | 6s + 2.7s infinite | ease-in-out | disabled |
| **In-app notice in (`notice-open`)** | 360ms | grid-rows 0fr→1fr, the app steps down | 150ms (global rule) |
| **In-app notice out (`notice-close`)** | 300ms | row collapses, card lifts | 150ms (global rule) |
| **Notice card settle (`notice-card-in`)** | 360ms | −12px + scale 0.985 → seat | 150ms (global rule) |
| Toast seat | Sonner default 400ms | seats at `--toast-top` (header + notices + safe area) | n/a |

---

## 4. Rationale: one line per non-obvious decision

- **Room keys live only in memory.** Refresh-locking isn't simulated; keys are actually dropped, so the locked state is real, not cosmetic.
- **PBKDF2 at 750,000 iterations** rather than a token spinner: the S3 wait is real work; the animation does not finish before the key does.
- **Verifier blob (encrypted known plaintext)** lets joiners detect wrong passwords without the server ever learning the password or a hash of it.
- **Identity inks are muted stationery tones**: distinguishable at a glance, yet none reads as an accent color; forest and terracotta keep their exclusive meanings.
- **The signature lives inside the ciphertext**, so a malicious relay cannot strip or swap it invisibly; registry pubkeys make forged senders detectable ("A message claiming to be from … was rejected").
- **Errors are neutral charcoal**: terracotta means impermanence, not failure; wrong-password is a fact, not a danger.
- **A banner never covers anything.** In-app notices open a grid track (0fr→1fr) at the top of the shell: the whole app steps down to make room. Overlays are for sheets and burns, never for an incoming message.
- **The top of the screen belongs to one thing at a time.** Toasts seat at `--toast-top` = safe area + header + measured notice-stack height, published live by a ResizeObserver, so a toast can never land on the header or on a banner.
- **Notification previews are a preference, and the default is "sender only."** The OS notification shade is exactly where ephemerality is easiest to forget; no message content appears unless the user asks for it. Files are never quoted: the act, not the contents.
- **Native notifications ride the service worker** (`registration.showNotification`), the only path that works on Android Chrome and installed iOS PWAs; the page-level `Notification` constructor is a desktop-dev fallback. Taps focus the app and navigate; a cold start opens `/#/r/:id`, where a locked room shows its unlock sheet, a first-class state.
- **The composer's send slot becomes "Reconnecting… / Re-sealing…"**: the one input that never silently accepts text it cannot send.
- **Ash cards persist for exactly one session**: the burned room stays visible for the session, and the next page load clears the desk.
- **Creator's empty room shows the invite verb** ("Copy invite link"), the joiner's shows the product statement ("You won't see messages from before you joined. That's how this works.").
- **The burn is the only centered modal** ("This destroys the room and its messages for everyone. This cannot be undone.") because it is the only irreversible act.
- **The sidebar's "New room" is a low-emphasis icon** so no screen ever carries two primary greens.
- **Local room names are never corrected**: two people may call the same room different things; the label is yours alone.
- **Unread is a 6px forest dot**: low-emphasis by policy; no counts, no badges, no streaks.
- **A quote is a copy, not a reference.** The reply carries its own snapshot of the quoted words, encrypted inside its frame at compose time, so the quote still reads after the original burns. Tapping it jumps to the original while it lives in session memory, and shows a plain notice when it doesn't ("That message is no longer in this session").
- **View-once targets are quoted as "Sealed message."** A quote is a preview, and a sealed card promises no previews, so the reply never leaks what opening would have shown.
- **Files open in the app, never handed to the browser.** Decrypted bytes live in memory behind a revocable blob URL; the viewer decides what "opening" means per type: zoom, play, render, read, inspect bytes.
- **A view-once file has no download anywhere**: not on the card, not in the viewer. Viewing is the point; the plaintext never touches the disk through us. (The standing limit holds: a determined member can still screenshot; a policy cannot remove that.)

---

## 5. Architecture (for the record: protocol v2, Task 19)

- **Client** (`/`, hash-routed `#/`, `#/new`, `#/join/:id`, `#/rooms`, `#/r/:id`): all crypto in WebCrypto + hash-wasm + @noble/curves.
  - **Entry key (kv 1)**: argon2id (m=64 MB, t=3, p=1) from the room password and a random 16-byte salt carried in a **versioned key bundle** (`{v:2, alg:"argon2id", ...}`) stored on the room. Rooms created before the upgrade (versionless PBKDF2-SHA256/750,000-iteration bundles) still unlock through the legacy path.
  - **Room passwords** (`src/lib/identity.ts`, hardened in Task 26 after a security review, default raised to six words in Task 31): generated as **six words from a 256-word list**: one CSPRNG byte per word (`crypto.getRandomValues`, rejection-guarded so any future list size stays unbiased, duplicates skipped). That is **2^48 candidates**; the verifier bundle is a public offline oracle, so the keyspace must survive argon2id grinding (the old 24-word/4-pick generator held 18 bits and drew from `Math.random()`: a predictable stream, and the whole space fell in under 7 CPU-hours; the 5-word interim held 40 bits: a laptop-year, but a ~100-GPU cluster grinds it in months, and 48 bits multiplies that grind by 256×: multi-year even for a large cluster, multi-century on one machine). **Retention policy**: the plaintext lives in the memory-only `RoomSession` for exactly as long as the room is open: the invite sheet re-displays it (masked, reveal toggle) so members can bring someone in at any time, and legacy v1 rooms re-derive epoch keys from it. And it is never written to disk; refresh locks every room and empties it. Password *inputs* clear the moment their job is done, mask by default with a keyboard-operable reveal toggle, and declare `autocomplete="new-password"` (the documented suppressor; `off` is advisory and Chrome would otherwise offer to save an ephemeral room password to its on-disk manager). Since Task 27 they are also **uncontrolled by construction** (`PasswordField` omits `value`/`defaultValue` from its props): a controlled React input mirrors every keystroke into the DOM `value` *attribute*, which put the plaintext in the Elements panel, in React DevTools state, and in reach of DOM-attribute scans even while the field rendered as bullets. The secret field never writes the attribute at all and holds nothing in React state: parents seed and wipe it imperatively through the DOM property (`el.value = …`), read it once at submit, and the plaintext dies with the input node on unmount. Inherent limit, stated plainly: the DOM `value` *property* of any input is always readable from the user's own browser (`$0.value` in the console). That is true of every site that has ever had a password box; that is the irreducible minimum, since the page must be able to read the secret to encrypt with it. Masking and the absent attribute defend against shoulder-surfing, screenshots, and casual inspection, not the user's own machine, which is the user's to inspect.
  - **Wire protocol v2** (`src/lib/protocol.ts`): every frame is `body JSON → sign (ECDSA P-256, canonical v2) → pad to a fixed size → AES-256-GCM`. Control frames (text, typing, receipts, burns, key offers, file metadata) are uniformly **20480+16 bytes**; file transfers are **exactly 45 uniform frames** (1 meta + 44 chunks of 65536+16, payload padded to a fixed 2,800,000 base64 characters) regardless of true file size: the relay cannot distinguish typing from messages or read file sizes.
  - **Quoted replies** (round 29; `src/lib/types.ts` + `src/lib/protocol.ts`): a reply carries a **snapshot** of its target: `ReplySnapshot {id, senderId, snippet, file?}`, built at reply-compose time by `makeReplySnapshot()` (view-once targets are quoted as **"Sealed message"**, never by their contents; file targets quote the file's name with `file: true`; text targets are whitespace-collapsed and capped at `REPLY_SNIPPET_MAX = 120` characters). The snapshot travels **inside the encrypted frame body**, and `canonicalV2` gained a 12th field, `replyCanonical()`, a deterministic unit-separator-joined serialisation of the snapshot, so **the quote is signature-covered: exactly as unforgeable as the words it carries**. (Task 31 refinement: the 12th slot is appended **only when a quote exists**, so a plain frame's canonical is byte-identical to the pre-reply eleven-field form, proven by a test that signs the old form and verifies it under the new one. Old tabs verify new plain messages and new tabs verify old ones; only a message that actually carries a quote needs both ends current.) A tampered quote breaks the ECDSA signature (proven by a direct test, not asserted). Verification recomputes the canonical from the **raw** snapshot before any sanitising (the receiver must rebuild the sender's exact string), and only then does `sanitizeReplySnapshot()` gate the view layer (id/senderId capped at 64 chars, snippet at 160, malformed shapes dropped; a failing snapshot renders the message unquoted, never broken). Reply frames ride the same uniform control-frame size, so a reply is size-indistinguishable from a plain message. The failure mode for a **mixed-version session**: an old tab running pre-reply code beside a new one will **drop** new reply frames rather than accept a quote it cannot verify; the message is lost for that tab, never forged.
  - **Replay defense**: per-sender monotonic counters inside a per-page-load session tag, a ±10-minute timestamp window, frame-id dedup, and watermarks persisted per room per device (survive refresh).
  - **Identity**: one random device seed; each room derives its own ECDSA P-256 signing key via HKDF(seed, roomId): same device, two rooms → different pubkeys and aliases, so registries cannot be correlated. Session ECDH P-256 pairs regenerate every page load (memory only).
  - **Key rotation** (`src/lib/room-protocol.ts`): when a member leaves, the deterministic coordinator (lowest memberId among connected members) generates a **random** key, never derived from the password, and delivers it pairwise over authenticated ECDH, signed, encrypted under the entry key so every member can read the offer but only the recipient can unwrap it. Departed members are evicted from local registries; their frames are refused. The server's room epoch is a persistent rotation ledger: rejoiners rotate past any key a departed member may still hold, and unanswered key requests self-heal through version-randomized fallback rotations that converge monotonically.
  - **Join delivery**: a member re-joining after a rotation receives the current key as an ECDH-wrapped offer additionally encrypted under the entry key; only a joiner who proved the password can open it.
  - **Image metadata: EXIF stripping** (Task 31; `src/lib/media.ts` + the composer's attach path): a photo must not leak where it was taken. Before an image is attached, its bytes are scanned by a **pure, byte-level detector** for the segments that hold camera metadata: JPEG `APP1` (EXIF **and** XMP packets) and `COM` free-text comments, PNG `eXIf`/`tEXt`/`iTXt`/`zTXt`/`tIME` chunks, WebP `EXIF`/`XMP` chunks. **Clean files pass through untouched**: no re-encode, no quality loss, no cost (most screenshots and downloads are already clean). Files that carry metadata are **re-encoded through a canvas** (decode → draw → encode: JPEG/WebP at quality 0.92, PNG losslessly), and it is the re-encoded bytes that get encrypted; the re-encoded output contains none of the original file's metadata. **Fail-closed**: if the re-encode fails or outgrows the file limit on a file that carried metadata, the file is not attached at all; the failure surfaces as a notice, never a silent send of location data. Scope, decided: SVG (no EXIF; never rasterised, since its scripts are neutralised by the img-context viewer) and GIF (comment-only metadata surface; a re-encode would kill animation) pass through. Cost note: the re-encode is a one-time decode+encode of the image on the sender's machine at attach time, imperceptible for photos. The attachment slip shows the re-encoded size, so the size shown is the size encrypted and sent.
  - **In-app viewing** (round 29; `src/components/cc/file-viewer.tsx`): every file opens **in the app** (images zoom, video and audio play, PDFs render, text/CSV/binary are read right there); nothing is handed to the browser's own viewer and nothing is force-downloaded. The decrypted bytes decode once to memory and render through **revocable blob: URLs** (created in an effect keyed on the message id, revoked on switch/unmount): nothing is fetched, nothing is written. **A view-once file has no download anywhere**: the Download button exists only for regular files, PiP and the context menu are suppressed on view-once media, and the viewer states the policy outright ("There is no download for this file, from anyone, by design"). PDFs render through **pdfjs-dist onto a `<canvas>`** (the worker vendored at `public/pdf.worker.min.mjs`, served from `/pdf.worker.min.mjs`) because a canvas carries no browser PDF toolbar, and therefore no save button. If pdf.js cannot load the document, regular files fall back to an `<iframe>`, but **view-once PDFs stay unopened** rather than expose the browser toolbar's save button (the notice says exactly that). **HTML is never executed**: rendered as escaped source ("Shown as source: HTML is never executed here"); **SVG is only ever shown through an `<img>`**, the context where its scripts cannot run; text is capped at 100 KB on screen while copy takes the whole file; CSV parses quote-aware into a capped table; unknown binaries get a metadata card and a hex dump of their first 512 bytes.
- **Server** (Next.js API routes + Prisma/SQLite): room lifecycle, member registry (**the only identity authority**, keyed by pubkey, so a forged relay join cannot overwrite a real member), creator-token-authorized burn, epoch ledger bump on leave, and since Task 22, leave itself requires proof-of-possession (a signature from the member's own room key). **Never sees plaintext or passwords; stores no messages.** All registry-touching endpoints are rate-limited per IP: room creation 5/min, room-info and verifier 30/min, member joins 12/min, leave 20/min, **abuse reports 5/min** (`POST /api/rooms/:id/report`, the one act of moderation the architecture permits, since Task 32 **graded by credibility**: a member-signed report (ECDSA proof-of-possession over `cc-report-v1:{roomId}:{memberId}:{ts}`, verified against the registered pubkey, ±10-minute window) terminates at once; an anonymous report is only queued; distinct reporting IPs are tallied in memory and three burn the room as the backstop. Every path answers the same `{ok:true}`, so existence and tally proximity are never confirmed).
- **Relay** (socket.io mini-service, :3003, in-memory): blind uniform-frame forwarding, presence, key requests. Token-bucket rate limit (20 frames/sec sustained, burst 64) per socket; oversized frames are a protocol violation and hard-disconnect; at most 16 rooms per socket. No DB, no history; new joiners see nothing from before they joined, by construction. Its internal second port (:3004, token-guarded, never gateway-routed, **the same process, not a separate service**) serves the presence snapshot the evict path consults and, since Task 31, `POST /terminate/:roomId`, the abuse path's way of telling every connected member a reported room is gone.

## 6. Threat model: what this does NOT protect against

Accurate claims only; these are the main limitations.

- **Metadata.** The relay sees who talks to whom, when, room ids, frame counts, and presence. Frames are size-uniform, so content *type* (message vs typing) and file *sizes* are hidden, but the fact and volume of communication is not.
- **View-once is a UI promise, not enforcement.** Any member can passively decrypt a view-once file on receipt and keep it, without ever opening the viewer. This is inherent to group E2EE (Signal has the same limit).
- **Silent leavers, bounded by the grace.** Rotation fires when a member *announces* departure, and since round 21 also when they silently vanish: every remaining client starts a 2-minute grace clock on the disconnect, and the connected coordinator (smallest memberId among live members) asks `POST /api/rooms/:id/evict` to write them out and bump the epoch, the rotation ledger. The route fails closed: it consults the relay's live presence snapshot (token-guarded, server-to-server on an internal port) as the connection authority, requires the caller to be live and the target offline for at least a minute. The residual is the 2-minute window itself; for a hostile exit, burn the room. A nuisance-evicter who knows only the roomId can force a rotation while someone is away; the departed member simply re-enters with the password (same accepted-risk class as insider nuisance-rotations).
- **Insiders can always sabotage.** Any current member can push a nuisance rotation, leave garbage, or publish the room key out-of-band. Group E2EE cannot defend against a malicious participant; it only keeps outsiders out.
- **A member can end the room at any time; a stranger needs corroboration** (Task 32, graded, replacing Task 31's flat "anyone who knows a room ID can end it" ceiling, which handed the system's weakest credential its strongest action): the abuse-report endpoint terminates a room by ID, and credibility is now graded exactly like the leave endpoint's proof-of-possession. A report signed by a **registered room key** (`cc-report-v1`, active members only; a departed member's powers do not outlive their membership) burns immediately: members are the only humans who can see content, so they are the only credible content reporters, and member-initiated burn was already covered by the insider threat above. An **anonymous** report is queued, not burned; three distinct reporting IPs (in-memory tally, web-tier restart resets it) are the corroboration backstop, and the operator retains the token-guarded relay `/terminate` for the legal path. The room ID remains the weakest credential (it appears in every invite link), but a link-holder's powers are capped again: join and see ciphertext, presence noise, rate-limited spam, and a report that only counts toward corroboration. Existence is never confirmed to strangers; a room killed this way is indistinguishable to its members from a creator's burn. There is no content to review, no member to suspend, no history to scrub; the operator contact (`abuse@cipherchat.app`, README + Settings → About) and the graded endpoint are the whole abuse surface.
- **The room password is immutable** for the room's lifetime (the verifier is set once at creation). Password knowledge can never be revoked; rotations exist so the key stops depending on it.
- **Endpoint compromise.** A compromised device (XSS, malware, physical access) reads everything and impersonates the user. Nothing in the browser can prevent this.
- **The relay and REST API are unauthenticated at the transport layer** (by design: no accounts). Forged relay joins cannot poison identity (REST registry is authoritative, keyed by pubkey) and forged leaves cannot force rotations (confirmed against REST first), but they can appear as transient presence noise.
- **Replay residuals.** Replayed frames are refused within a device's memory and across refreshes (persisted watermarks), but a frame captured within the ±10-minute window can be delivered *once* to a device that has never seen the room before (e.g., a fresh joiner on a new device). No history is stored anywhere; this is the residual cost of not trusting the relay with sequence numbers.
- **What lingers on your device.** The desk lives in localStorage: room cards (local names, unread counts: metadata, no secrets), creator tokens (burn authority, so treat device access accordingly), verification marks, and per-room replay watermarks (seen-message counters persisted for replay protection, non-secret residue that never leaves the device). Keys and message bodies are memory-only and die with the tab.
- **Not a nation-state adversary.** If your opponent is one, use Signal or SimpleX.

*Residuals closed in Task 22:* leaving now requires proof-of-possession: a signature from the member's own room key, so a leaked memberId alone can no longer write someone out or rotate the room out from under everyone. The room-info, verifier and members endpoints are per-IP rate-limited (the existence/epoch oracle and the registry write path are no longer scrapeable at will). The member cap is a freshness-windowed soft cap: it stops a code-holder without the password from permanently locking the room with throwaway keys, but a coordinated attacker with many IPs and keys can still exceed it: presence noise, not a confidentiality break.

---

## 7. Marketing page rules

These rules govern the landing and document surfaces (Task 40 onward, amended in rounds 3-5).

- **Swap test.** Cover the wordmark. If the page could sell any other privacy product, redo it. Identifiability comes from the product's own elements (its mark, its verbs, its copy), never from an arrangement of zones.
- **Behavior claims on marketing pages; algorithm names in the docs.** *"The relay cannot read a single frame"* is a behavior claim in plain words, and it is checkable. A cipher's name is vocabulary, and vocabulary is a flex. Algorithm names live in README / SECURITY / the protocol reader, linked from the footer.
- **One aphorism per product.** The voice already chose: **A conversation that leaves no trace.** No other tagline ships on any surface.
- **One gesture per page, carried fully.** The burn overlay is the reference: one decision (the room chars) carried through phases. A page gets at most one performed gesture; everything else is typesetting or a standard state change.
- **Marketing pages use house classes only.** The same verb system (sentence case, forest primary, quiet secondary; never the ALL-CAPS tracking-wide button), the same paper, the same mark, the same fonts the product itself uses. A marketing page adds zero CSS of its own; every class is a house class. If a marketing page needs a new class to be itself, that indicates staging.
- **No staging.** Round 3 (Task 41) removed staging that looked like AI output: a prop sheet rotated on a desk, a struck-through word in the headline, doubled grain, a performed sealing gesture. Identity comes from what the product already owns (the paper, the forest, the ink drop, the one aphorism, its header, its entrance, its breathing mark, its verb system, its footer caption), never from an arrangement of props.
- **Document pages use house fonts.** Round 4 (Task 42): the same Lora, Inter and Plex Mono the product uses, the same paper, the same hairlines, the app's own header. Plain headings in sentence case. Labels in sentence-case Inter, never mono ALL-CAPS. The copy speaks plainly: no conceits, no "field notes," no "receipts," no clever-fragment titles. A heading says what the section is; a sentence says the thing. A document page is allowed one table, numbered steps, and code in mono, because those are what documents actually use.
- **Plain vocabulary.** Round 5 (Task 43): public copy carries zero em-dashes (the one exception is the tagline's own dash), and vocabulary says the plain thing. "Generated" not "minted," "encrypted" not "sealed," "derived" not "stretched," "runs on every push" not "standing gates," "known limits" not "residuals." Standard crypto terms survive ("key stretching," AES-256-GCM, argon2id); metaphors do not. Flat sentences also leave numbers nowhere to hide: every number in public copy must hold on its own against the code. Round 5's catch: "room lifetimes up to a day" was wrong by a factor of thirty (the picker says minutes to 30 days, or until burned), and message timers go down to 5 seconds, not 15 (custom floor, `TTL_MIN_SEC`). The covenant sentence ("claims are checked against the code, and known limits are written down rather than hidden") ships in exactly one place, the author section, and even there it ships flat.

**Surfaces (one route, three modes):** `/` is the landing: flat, centered, nothing rotated, nothing floating, no shadow, no performed gesture; the breathing mark, the Lora headline, one Inter meta line, two house-styled buttons, the trust caption, the docs links in the footer. `/?read=1` is the protocol page: a plain document in the house fonts (Lora headings, Inter prose, Plex Mono for actual technical strings), an "On this page" line, hairline sections, one table, one live example. `/?app=1` is the product itself, unchanged.
