# CipherChat — Component Reference

Every component in the app, what it does, how it works, and the rules it obeys.
Companion to `DESIGN.md` (tokens, rationale) and `worklog.md` (development history).

**How to read this document:** sections follow the layer cake of the app —
shell → screens → chat surface → sheets → ceremony overlays → primitives →
hooks → styling system → shadcn inventory → data layer. Each component entry
lists its file, its spec screen (S1–S9 from the product brief), its props/API,
its states, and the internal mechanics that make it interesting.

---

## 1. Architecture at a glance

```
src/
├── app/
│   ├── page.tsx              # The ONLY route ("/") → <CipherChatApp/>
│   ├── layout.tsx            # Fonts (Lora/Inter/Plex Mono), ThemeProvider, Toaster,
│   │                         #   grain overlay, SW registration, viewport meta
│   └── globals.css           # Token sheet, typography classes, keyframes, keyboard CSS
├── components/
│   ├── cc/                   # CipherChat product components (this app's real library)
│   ├── screens/              # Page-level screens (S1, S2, S4, S5/S8)
│   └── ui/                   # shadcn/ui primitives (mostly untouched stock)
├── hooks/                    # useIsDesktop, useKeyboardInset
├── lib/                      # crypto, identity, session, local, relay, format, types
└── store/app.ts              # Zustand orchestrator — the app's brain
```

**One route, four screens.** There is no Next.js routing beyond `/`. Navigation
is a hash router driven by the store: `#/` (landing), `#/join/:code` (invite),
`#/rooms` (desk), `#/r/:roomId` (chat). Invite links land as `/?join=CODE` and
are rewritten to `#/join/…` on boot.

**Three layers of components:**

| Layer | Directory | Role |
|---|---|---|
| Screens | `components/screens/` | Own a whole viewport, map 1:1 to spec screens S1–S8 |
| Product components | `components/cc/` | Reusable surfaces inside screens (composer, bubbles, sheets…) |
| Primitives | `components/ui/` | shadcn/ui. Only **Sheet, Dialog, ContextMenu, Sonner** are used; the rest is stock scaffolding |

**Data flow.** Everything user-visible flows from one Zustand store
(`store/app.ts`). Components subscribe with atomic selectors
(`useApp((s) => s.messages[roomId])`), never hold server state locally, and
call store actions for every mutation. Secrets (room keys, passwords) never
enter the store — they live in the module-memory `lib/session.ts`, wiped by
refresh. Quoted-reply snapshots (`MessageView.replyTo`) are data, not
secrets — copies of words already shown to the room.

**Server model.** REST (`app/api/rooms/*`) manages room lifecycle only.
A socket.io mini-service on port 3003 (`lib/relay.ts` → `io("/?XTransformPort=3003")`)
relays encrypted envelopes and presence in memory. Neither ever sees plaintext.

---

## 2. App shell

### `CipherChatApp` — `components/cc/app.tsx`

The root client component. Responsibilities:

1. **Boot** — calls `init()` (loads device identity, room cards, hash route).
2. **Keyboard awareness** — mounts `useKeyboardInset()` once, publishing
   `--kb-inset` for every sheet and the shell (see §8).
3. **Invite deep-link** — reads `?join=CODE`, rewrites to `#/join/:code`.
4. **Screen routing** — `<Screens/>` picks the active screen by store state.
5. **Global overlays** — `<SealingOverlay/>` and `<BurnOverlay/>` render above
   everything when the store says so.

The desk+room layout (non-landing screens) is a `flex h-dvh` shell:

- `pb-[var(--kb-inset,0px)]` — the whole shell rises above the mobile keyboard.
- Sidebar: `w-full` on mobile, `w-[320px]` + hairline border on `md:`; hidden on
  mobile while a room is open (`hidden md:block`), iMessage-style.
- Desktop with no room open shows the quiet placeholder (seal + "Open a letter,
  or start a new one.").

### `page.tsx` / `layout.tsx` — `src/app/`

`page.tsx` is 14 lines: Suspense (for `useSearchParams`) + `<CipherChatApp/>`.
`layout.tsx` loads the three typefaces via `next/font` (CSS variables
`--font-lora`, `--font-inter`, `--font-plex-mono`), mounts `ThemeProvider`
(next-themes, class strategy, light default), the Sonner toaster (top-center),
the full-viewport paper grain `<div className="grain"/>`, and `SwRegister`.
The viewport export sets `viewportFit: cover` (safe areas) and
`interactive-widget: resizes-content` (Android keyboard behavior).

---

## 3. Screens

### `LandingScreen` — `screens/landing.tsx` · **S1**

The five-second decision surface. Seal breathing (the app's single intentional
idle loop), one display headline ("A conversation that leaves no trace."), two
actions — **Create a room** (forest primary) and **Join with a link or code**
(secondary) — plus a quiet "Back to your rooms" escape that only exists when
rooms exist. Footer carries the trust line: "Messages are encrypted in your
browser and destroyed on schedule."

- `[@media(max-height:720px)]` compaction keeps the fold honest on short screens.
- `ThemeToggle` lives in the header.

**`CreateRoomSheet`** (internal): bottom sheet (mobile) / plain sheet (it is
always `side="bottom"`; the grabber shows on touch) with two fields — room name
(private label, maxLength 60) and password **pre-seeded with a generated
passphrase** (`generatePassphrase()` — five CSPRNG-picked words from a
256-entry list, 40 bits), refreshable via a "New password" quiet
action. The field masks by default (`PasswordField`, eye toggle to
reveal). **The passphrase is never React state** — it is seeded straight
into the field's DOM *property* when the sheet opens (and re-seeded via
the refresh action), read once at submit, wiped on success, and dies
with the input node when the sheet unmounts. The DOM `value` *attribute*
is never written, so the Elements panel shows no value on this field
for its entire life. Submits `createRoom(name, password)`; on
success closes and toasts the standing advice ("Share the link — and
the password through a different channel."). Error state is neutral
charcoal, never terracotta.

### `InviteScreen` — `screens/invite.tsx` · **S2**

Where a stranger lands from a shared link. Order of information is fixed by
spec: reassurance headline → room code (prefilled when arriving via
`?join=`, formatted `ABCDE-FGHIJ`, hidden input when prefilled) → password →
Enter. Below, a collapsed **"What happens next"** disclosure (grid-rows
0fr→1fr animation) with the three facts: encrypted in browser, nothing stored,
creator can burn.

States: default · busy ("Entering") · wrong password (inline, neutral:
"That password doesn't match this room.") · room gone ("This room doesn't
exist, or it has been burned." — also marks the local card as ash) · room full.
`reasonCopy()` maps every `JoinResult.reason` to calm copy; there are no
exclamation marks anywhere in the product.

### `RoomListColumn` — `screens/room-list.tsx` · **S4**

"The desk." One component serves both breakpoints — full screen on mobile,
320px sidebar on desktop. Header: title, quiet `+` New room icon button,
ThemeToggle. Footer: underlined "Have an invite link? Join a room".

**`RoomListBody`** renders one of four states:

| State | Render |
|---|---|
| Empty desk | Seal + "No rooms yet." + Create/Join actions (empty state as product statement) |
| All locked | Hint line: "Rooms lock when you refresh — re-enter each password to return." |
| Mixed | Same hint (shown when ≥1 locked) |
| Burned | Ash cards (below) — swept from storage on next full reload |

**`RoomCardRow`** — one letter on the desk. Shows local name (never corrected
across members), member count, `fmtAgo` last activity, and a forest unread dot
seated on the name's x-height. Hover = paper lift (`-translate-y-px` + forest
border). Open room = forest/30 border + wash. **Locked** cards sleep: no lift,
lock glyph, muted meta (lock = locked state, distinct from the security badge).
**Burned** cards render as dashed ash with a −2° strikethrough and mail glyph,
`aria-disabled`, gone after reload.

**`UnlockSheet`** — exported. Re-enters a locked room: password → `joinRoom` →
S3 sealing → chat. Same neutral error mapping as S2.

### `ChatScreen` — `screens/chat.tsx` · **S5/S8 + locked state**

The room. First render checks `getSession(roomId)` — no session means **locked**
(a first-class state, never an error):

- **`LockedRoomView`** — centered card: lock tile, room name, the key-truth copy
  ("Keys live only in memory — re-enter the password to return."), password
  field, Unlock, back action. Header buttons toast "Unlock the room first".

With a live session, **`ActiveRoom`** assembles the room:

- `ChatHeader` (below)
- Message scroll area: `role="log"` + `aria-live="polite"`, quiet scrollbar,
  `max-w-[720px]` column. Auto-scrolls to newest on arrival **unless** the user
  is scrolled up >220px — then the jump pill counts what arrived below the fold
  ("3 new messages" with forest dot, or "Latest" with chevron). Self and system
  messages always auto-scroll.
- **Empty states (S8):** creator-solo gets the invitation moment (Copy invite
  link / Show the password); a joiner gets the product statement —
  *"You won't see messages from before you joined. That's how this works."*
- **`TimeAwareMessages`** — walks grouped messages and inserts a quiet
  timestamp divider when the gap exceeds 30 minutes ("17:04" / "Wed · 17:04",
  `role="separator"`).
- **`TypingLine`** — a reserved 26px strip above the composer (space is always
  there, so nothing jumps). Renders the whisper: "Velvet Owl is writing…" /
  "A and B are writing…" / "Several people are writing…" with aliases in their
  ink colors, `aria-live="polite"`.
- **TTL hint strip** — one-time, 10s, dismissible explanation of expiry
  ("Messages set to expire burn themselves when the clock runs out — for
  everyone.") shown the first time a TTL is armed in a room whose default is 0.
- `Composer` (below), then the three sheets and `FileViewer`.

State handling note: room-prop changes (switching rooms) use the sanctioned
render-time adjustment pattern (`if (roomId !== hintRoomChecked) setState…`) —
no effects for derived state.

**Round 29 state** — `replyTarget` (the message being answered; memory-only
like everything else) and `viewing` (the file open in the viewer). Both are
released by the same render-time pattern when their message burns — a letter
that burns while being read must not linger on screen, and you cannot answer
what is no longer here. `jumpToMessage(id)` finds the row via
`[data-mid="${CSS.escape(id)}"]`, scrolls it to the center, and restarts the
`quote-flash` pulse (class remove → forced reflow → add, so repeated jumps
re-announce); a target that is gone toasts "That message is no longer in
this session" instead. `beginReply` seats the quote and closes the viewer if
one is open. The window-level Escape guard also steps aside while a reply is
pending.

---

## 4. Chat surface

### `ChatHeader` — `cc/chat-header.tsx`

Room name in Lora (native `title` tooltip reveals the full name), member count
and offline pulse in Inter meta. Exactly **three icon buttons, all 44px** with
press-in active states: Share invite (Link2), **Verify participants (Shield —
the only security glyph in the app)**, Room settings (Settings2). Back chevron
is mobile-only. Sticky, safe-area aware (`pt-[env(safe-area-inset-top)]`).

### `Composer` — `cc/composer.tsx`

The writing surface, and the most stateful leaf component. A sticky,
`composer-blur` (backdrop-blur — one of exactly two blurred surfaces) strip.

| Element | Behavior |
|---|---|
| Textarea | Auto-grows 1→3 lines (24–66px), Lora 15.5px, Enter sends / Shift+Enter newlines, `maxLength 4000` |
| Attach (paperclip) | Hidden `<input type=file>`; ≤2MB (`FILE_LIMIT`), base64-encoded in 8KB chunks. **Images are scanned first** (`lib/media.ts`): a byte-level detector looks for EXIF/XMP/comment segments (JPEG APP1/COM, PNG eXIf/text chunks, WebP EXIF/XMP); clean files pass through untouched, files that carry metadata are re-encoded through a canvas (JPEG/WebP q0.92, PNG lossless) and it is the re-encoded bytes that attach — the slip shows the new size. **Fail-closed**: a metadata-carrying image that cannot be re-encoded is refused with a notice, never attached as-is. SVG and GIF pass through by scope (see DESIGN.md §5) |
| Drag & drop | Dashed forest "Release to attach" overlay while hovering |
| Paste | Clipboard files into the textarea attach instead of inserting |
| TTL chip | Cycles OFF → 5m → 1h → 8h; armed state is terracotta; the first-ever arming raises the hint strip instead of a toast |
| Attachment slip | Paper tile + name/size + **View once** toggle + remove; expanded hit areas on the small chips |
| Reply slip (round 29) | The quoted words above the input (alias + snippet + X to cancel); beginning a reply focuses the input — touch included, the reply IS an intent to write; submit seals the quote snapshot into the message (`makeReplySnapshot` at send time, so the quote is exactly what was on screen); **Escape releases the quote first** (stopPropagation keeps the window-level escape-to-rooms handler from seeing the key) |
| Send | Forest circle with arrow; disabled unless text or attachment exists |
| Offline | Send button is replaced by a status chip: "Reconnecting" (relay down) or "Re-sealing" (key rotation after someone left) — you never type into a void silently |
| Near limit | "N characters left" appears under 200 remaining; at zero, calm terracotta copy ("…as long as a letter can be") |

State is keyed per room (`<Composer key={roomId}>`), TTL seeded from the room's
local default. Sending is optimistic: text clears instantly, focus is kept, the
store handles sign→encrypt→relay and the bubble shows "Sending" (60% opacity,
pulsing dot) until the ack.

### `bubble.tsx` — messages

**`useMessageGroups(messages)`** — pure hook that computes `BubblePosition`
(`first`/`last`/`showTime`) for every message: consecutive messages from the
same sender within **3 minutes** collapse into a group; alias shows on `first`,
timestamp on `last`. System lines break groups.

**`MessageBubble`** — self right-aligned (`.bubble-self`, forest-tinted paper),
others left (`.bubble-other`) with the sender's ink dot + alias in
`var(--ink-N)`. Corner language: 18px radius, collapsing to 6px on the corners
nearest the sender (group-internal edges). Max width 75%. Entrance is the
`rise` keyframe. States: sending (60% opacity) → sent; `burning`
(`msg-burning` — ember-rim glow into the 600ms dissolve, handled by the store's
burn choreography). File messages render the caption (`message.text`) as
`t-body` above the file card — the caption rides the meta frame's canonical-
signed text field, so it is exactly as authentic as a text message. A reply
renders its **`QuoteBlock`** inside the bubble, above the body. Every row
carries `data-mid={message.id}` — the jump target. Three roads to the same
verb (round 29): a hover-only reply icon button beside the bubble on desktop
(`group/row` opacity transition, `-left-10` for self / `-right-10` for others
— a mouse thing; touch uses press-and-hold), the context menu's "Reply" item,
and a double-click on the bubble itself.

**`QuoteBlock`** — the strip of the message being answered, a small letter
inside the letter. Left border (2px) in the **quoted sender's own ink**
(`var(--ink-N)`; "Someone" in mute if they have left, "You" if it is you),
alias + snippet, a `FileText` glyph when the quoted message carried a file.
The snippet is a copy the reply itself carries, so the quote survives the
original burning — the words were already shown to the room. Clicking jumps
to the original while it lives in session memory; it is a real focusable
button whose `aria-label` tells the truth either way ("Jump to the original"
/ "The original is no longer in this session").

**`CopyMenu`** — Radix ContextMenu wrapping every bubble (right-click desktop,
press-and-hold touch): **"Reply"** (first item, when a reply handler is
wired — round 29) · "Copy text" / "Copy caption" (file messages with a
caption) / "Copy file name" → toast; **"Mark this message"** — a submenu with
the four ink marks (✓ Acknowledged · ✦ Noted · ♥ Warmly received · ☾ Later,
`REACTION_MARKS` in `lib/types.ts`), the one you currently hold flagged with a
forest dot; and for **your own sent messages only**, "Burn message" — a
 two-step arm inside the menu (first press turns the item terracotta and
 re-labels "Burn for everyone",
second press executes). Styled as paper: 12px radius, hairline, single soft
shadow via arbitrary value (beats shadcn's layered `shadow-md`).

**`MarksBar`** — the ink-mark chips under a bubble: one pill per mark
(serif glyph + tabular count, `.mark-chip` entrance + `.mark-count` beat).
Pressed state when YOU hold the mark (forest-tinted). Clicking a chip toggles
your own mark on/off; `title`/`aria-label` name who marked. Marks resolve
memberIds → live aliases at render time ("Someone who left" fallback). The
wire side: `sealReact` frames — mark glyph rides the canonical-signed `text`
field, target rides `messageId` (see `room-protocol.ts`); one mark per sender
per message; the toggle transition is applied identically by the optimistic
local update and every receiver.

**`TtlRemaining`** — ticking countdown (1s interval) with terracotta hourglass
glyph, `tabular-nums` so the meta row never jitters. Label from
`fmtTtlRemaining` ("4:59" → "moments").

**`FileContent`** — the file presentations (round 29: opening is every
card's job now — downloading is a choice the viewer offers, never the
card's whole job):
- **View-once sealed** — a paper card with mail glyph: "Sealed — View once —
  opening destroys it"; opens `FileViewer`.
- **View-once spent** — `.spent-card` with ember rim: "Opened — the contents
  are gone". Never re-opens (enforced server-side too: spent IDs are
  broadcast).
- **Images** — inline base64 `img` (max-h-56), click to open viewer.
- **Video / audio / other files** — an open-in-the-viewer card: file tile
  wearing the kind's glyph (Film for video, Music for audio, FileText
  otherwise), kind label ("Video" / "Audio" / "File") + name + size, and an
  Eye glyph that warms to forest on hover. Nothing downloads directly.

**`downloadFile(name, mime, dataB64)`** — exported helper: base64 → Blob →
object URL → synthetic anchor click → revoke after 4s. Toast on success/fail.
Since round 29 its only caller is the viewer's Download button — the cards
never call it.

**`SystemLine`** — quiet centered meta text ("Quiet Heron joined.", "A message
claiming to be from X was rejected — signature invalid."). System lines are
`kind: "system"` messages; they never carry identity.

### `FileViewer` — `cc/file-viewer.tsx`

A **full surface, not a modal** — centered modals are reserved for irreversible
moments. Fixed overlay of `bg-paper/95` + 16px blur (the second blurred
surface), `role="dialog"` (not modal — the room stays alive behind it).
**Round 29 rewrote it: every file opens IN THE APP now** — no forced
downloads, nothing handed to the browser's own viewer.

**Classification** — exported `classifyFile(mime, name)` routes by mime
first, then file extension: `image/*` → image · `video/*` → video ·
`audio/*` → audio · `application/pdf` / `.pdf` → pdf · `text/csv` / `.csv` →
csv · text-ish mimes plus a `TEXT_EXTS` allowlist (code, config, markdown,
svg, …) → text · everything else → binary.

**Blob lifecycle** — the base64 decodes once to a `Uint8Array` in memory; a
single object URL is minted in an effect keyed on the message id and revoked
in its cleanup (`URL.revokeObjectURL`) on switch or unmount. Nothing is
fetched, nothing is written. When the viewed message changes (or the viewer
closes), zoom, wrap and the decoded bytes reset through a guarded
render-time adjustment on a `viewingId` state — the sanctioned no-effect
pattern — so a departing file's plaintext leaves React state the instant it
is no longer the file on screen; the effect itself only mints and revokes.
The viewing copy was taken at open time, so a
message burning behind the viewer doesn't yank the bytes — the chat screen
closes the viewer when its message goes.

Per type:

- **Image** — contained; click/Enter/Space toggles 220% zoom
  (`cursor-zoom-in/out`, focus ring, keyboard-operable `role="button"` img;
  same behavior as always, now fed from the blob).
- **Video** — `<video controls playsInline
  controlsList="nodownload noremoteplayback">`; view-once additionally
  disables picture-in-picture and suppresses the context menu.
- **Audio** — a styled card (music glyph in a forest circle, name, size) with
  the same `controlsList`.
- **PDF** — rendered by **pdfjs-dist v6 onto a `<canvas>`** (worker vendored
  at `public/pdf.worker.min.mjs`, served from `/pdf.worker.min.mjs`; a
  static asset, eslint-ignored as vendored): devicePixelRatio-aware scaling
  (capped 2×), fit-to-width, Back/Next page nav, "Page x of y". A canvas
  carries **no browser PDF toolbar and no save button** — that is the point.
  pdf.js transfers buffers, so it is handed `bytes.slice()` — a copy — and
  our bytes stay ours. If pdf.js fails to load the document: regular files
  fall back to an `<iframe>` with the blob URL (honest degradation), but
  **view-once files stay sealed** — the notice says falling back would expose
  the browser PDF toolbar's save button, and asks the sender to re-share. A
  page that fails to render sets a failed state, never a blank canvas.
- **Text** — escaped plain text in a monospace `pre` (React escaping — never
  innerHTML), wrap toggle, `TEXT_SHOW_MAX = 100_000` on-screen cap ("copy
  takes the whole file"). HTML files carry the label "Shown as source — HTML
  is never executed here"; SVG rides an `<img>` context, where its scripts
  cannot run.
- **CSV** — `parseCsv()` (exported, pure, quote-aware RFC-4180-style: doubled
  quotes, commas and newlines inside quoted fields, CRLF tolerated, empty
  rows dropped) into a sticky-header table capped at **500 rows × 32 cols**
  (`CSV_MAX_ROWS` / `CSV_MAX_COLS`) — wide rows clipped, copy takes the whole
  file.
- **Binary** — a metadata card (name, size, "inspected in memory") plus a
  hex dump of the first 512 bytes (offset · hex · ASCII gutter).

Header row: name · size · mime (+ "view once" marker). Buttons: **Copy
contents** (text-ish files — copies the whole file), **Download** (present
ONLY for non-view-once files), Close. **A view-once file has no download
anywhere** — not on the card, not in the viewer — and the policy is stated
outright beneath the header: "View once — it lives on screen only. There is
no download for this file, from anyone, by design."

**View-once spending happens the instant the viewer opens** — `onSpent`
fires on `message.id` change; the bubble becomes the spent card behind the
viewer simultaneously for everyone in the room.

Escape closes; body scroll lock is not needed (fixed overlay).

**Chat keyboard layer** (`screens/chat.tsx`) — Escape with an empty composer
returns to the room list. Sheets, menus, dialogs and the file viewer own the
key first (they prevent it, and `[data-state="open"]` / `[role="dialog"]` is
checked besides); a reply in progress owns it before all of that — the
composer's own keydown releases the quote and stops propagation; and a
composer holding words never loses them to a stray Escape. **`TypingLine`** carries three `.typing-dot` ink dots (aria-hidden,
staggered 180ms) before the aria-live sentence. **`ChatHeader`** renders per-
member presence dots in each member's own ink (`.dot-in` entrance, away
members rest at 35% opacity) before the member count.

---

## 5. Sheets

All sheets share one skeleton: shadcn `Sheet` (Radix Dialog underneath) with
`side={isDesktop ? "right" : "bottom"}`, `SheetGrabber` on mobile, and the
keyboard-aware geometry from §8 (`bottom-[var(--kb-inset)]`, `max-h` capped,
internal `scroll-quiet` scrolling). Desktop sheets are right-side, 440px,
rounded-left 18px.

| Sheet | File | Spec | Opens from |
|---|---|---|---|
| `CreateRoomSheet` | `screens/landing.tsx` | S1 | Landing "Create a room" |
| `UnlockSheet` | `screens/room-list.tsx` | S4 | Locked room card |
| `InviteSheet` | `cc/invite-sheet.tsx` | S5 | Header link icon; auto-opens once after room creation |
| `VerificationSheet` | `cc/verification-sheet.tsx` | S7 | Header shield |
| `SettingsSheet` | `cc/settings-sheet.tsx` | S9 | Header settings icon |

### `InviteSheet`

The link + the password, with the standing advice. Layout: label rows carry
their actions (Copy on the link; Show/Hide + Copy on the password) so value
boxes stay full-width `break-all` mono — long passphrases never wrap the
layout. Password reveals with `select-all` for manual copying. Below, the
**in-person block**: a 108px QR of the invite link (generated client-side via
`qrcode`, charcoal-on-daylight-paper **always light in both themes** — a code
is a physical object, scanners agree), with the reminder that the password
still travels separately.

Auto-open rule: after creating a room, the invite opens once per room
(`sessionStorage cc.inviteShown.<roomId>`) — the natural next verb.

### `VerificationSheet` · **S7**

The hardest security-UX problem, made one-tap. One row per member:
ink dot + alias (their ink) + **8-hex fingerprint in mono, grouped
`3F2A · 91BC`** + copy button (expanded hit area) + a manual verify switch
(`role="switch"`). Self is marked "· you" with no switch. Fingerprints are
computed async from each member's public key (`keyFingerprint` — deterministic,
identical for every viewer) with a `···· ····` placeholder while pending.
Verified marks persist per room in localStorage (`lib/local.ts`) and also show
as forest checks in Settings.

Footer: the "What is a fingerprint?" glossary (grid-rows disclosure) — the
one-tap explanation of MITM checking without the word MITM.

### `SettingsSheet` · **S9**

Local-only settings, ordered by weight: **Room name** (private label, "Others
may label this room differently. CipherChat never corrects this.") ·
**Default message lifetime** (4-cell segmented radio group: Off/5m/1h/8h —
forest when selected) · **People here** (ink dot + alias + verified checks +
"· you"). Then whitespace — not a header — and the exit: **Burn this room**
(creator, terracotta) or **Leave room** (member, secondary), each with its
consequence line ("Burning destroys the room for everyone, unrecoverably." /
"Leaving rotates the room key for those who stay.").

Burning opens the app's **only centered modal** (shadcn Dialog):
"**Burn this room?** This destroys the room and its messages for everyone.
This cannot be undone." → Burn the room (terracotta, busy state) / Cancel.
The creator token lives in localStorage (`lib/local.ts`) so a creator can
still burn after a refresh.

Fields re-seed via the render-time pattern whenever the sheet re-opens.

---

## 6. Ceremony overlays

These are the two moments the product is named for. Both are full-viewport,
z-70/z-80, driven entirely by store state.

### `SealingOverlay` / `Sealing` — `cc/sealing.tsx` · **S3**

The key-derivation moment, staged as a vault press, not a spinner. A 96px
circular SVG: hairline track + forest arc that fills over **1700ms** with
`cubic-bezier(0.2,0,0,1)` (`seal-arc`), a `seal-press` scale-weight on the
whole dial, the SealMark centered inside. Copy: "Sealing the room" /
"Deriving your encryption keys. This takes a moment on purpose." — the
deliberate slowness is honest: argon2id with 64 MB of memory hardness
genuinely takes a moment, and the store enforces `MIN_SEAL_MS = 1700` so
the theater never finishes before the crypto does. `role="status"` +
`aria-live="polite"`.

The inner `Sealing` component is reusable with custom label/sub; the store's
`sealing: SealingState | null` drives the wired version (also used while a
rejoined member awaits key delivery: the composer's "Re-sealing" chip).

### `BurnOverlay` — `cc/burn-overlay.tsx` · **S6 (room)**

The signature two seconds, phase-driven by a timer chain:

1. **char** (0–2000ms): a 340% radial gradient chars inward from the screen
   edges (`char-close` — transparent center, terracotta whisper, warm blacks),
   the page warms and darkens (`char-veil`), an ember rim breathes at the
   edges (`ember-rim`, inset box-shadows), charred grain fades in
   (`char-grain`, feTurbulence noise, multiply blend).
2. **line** (2000ms): Lora 22px in warm parchment with a soft ember
   text-shadow — *"This room has been burned."* (`burn-line-in`).
3. **out** (3400ms): whole overlay fades (`burn-out`), and at 3800ms
   `finishRoomBurn(roomId)` navigates to the desk where the ash card waits
   for exactly one session.

`role="alert"` + `aria-live="assertive"` — this one is allowed to interrupt.
Single-message burns are quieter: the bubble's `msg-burning` (ember rim →
dissolve upward) handled in the store's message pipeline.

---

## 7. Shared primitives

### `actions.tsx` — the verb system

One primary verb per screen; **forest = trust/action, terracotta =
destruction/impermanence only**. All share a base: 48px height, 12px radius,
Inter 14px medium, 150ms transitions, press-in `active:scale-[0.99]`,
disabled = 50% opacity + no pointer events.

| Export | Look | Use |
|---|---|---|
| `PrimaryAction` | Forest fill, paper text | The screen's main verb |
| `SecondaryAction` | Side surface, hairline border | The alternate path |
| `DestructiveAction` | Terracotta fill | Burn / leave (consequence-modaled) |
| `CompactAction` | Forest, 44px | Header-placed primary |
| `QuietAction` | Text-only, mute → charcoal hover | Escapes and tertiary links |

All accept `busy` (spinner + disabled) and `full` (block width). Forwarded refs
throughout.

### `fields.tsx` — inputs

Paper surfaces, hairline borders, forest focus (border 45% + 15% ring).
**Errors are neutral charcoal** — only actions carry color.

- `Field` — label + children + hint/error slot (error wins, `role="alert"`).
- `TextField` — 48px input, Inter 15px.
- `PasswordField` — the **uncontrolled secret field** (Task 27): accepts no
  `value`/`defaultValue` (typed out via `Omit`), so React never mirrors the
  typed text into the DOM `value` *attribute* — Elements shows no value for
  the field's whole life, and no plaintext ever sits in React state. Parents
  seed/wipe imperatively via the forwarded ref (`el.value = …` sets the
  property only) and read once at submit. Eye toggle (44px hit area,
  keyboard-focusable, `aria-pressed`), `autoComplete="new-password`"
  (the documented suppressor of Chrome's save-password prompt for
  ephemeral room passwords), no autocapitalize/spellcheck.
- `MonoValue` — selectable mono block with an inline copy affordance and
  "Copied" confirmation state.

### `mark.tsx` — `InkMark` (The Vanishing Ink)

The brand mark: a hand-fallen ink drop, seated on the page, its top
fraying into three rising flecks — the last one ember-warm. Hand-tuned
beziers on a 96×96 grid (joint radii wobble a few percent off a compass
circle, the tail leans a hair), the whole assembly rotated 21° so the
flecks rise up-and-right — off the line of text, the direction writing
leaves in. The product metaphors: the drop is the writing, the flecks
are the ephemerality, the ember is the heat of the conversation
leaving — not the paper burning. Four variants:

- `intact` (default) — the seated drop with its flecks rising. With
  `breathe`, the flecks quietly rise and fade on a staggered loop
  (`.ink-fleck-1/2/3` classes carry the stagger in globals.css — the
  hero's landing choreography stacks a second animation on the same
  flecks, and a single inline `animation-delay` would bind both).
  Brand, landing hero, desk centrepieces.
- `scattered` — the drop has lifted off: its outline rises away while
  seven flecks flee outward and the ember flares once. Animates once
  on mount. Burn/destruction contexts only (terracotta is legitimate
  there — see the burn overlay).
- `fleck` — one four-pointed fleck alone in `currentColor`, so member
  inks (`--ink-0..7`) can drive it from outside. The identity system:
  every member is a fleck of the same vanishing ink (bubble sender
  lines, the typing whisper's three rising flecks).
- `ghost` — the drop's outline stroked in `currentColor`, flecks
  filled. Watermarks at whisper opacity; never intercepts a touch.
  With `draw`, the outline inks itself onto the page (pathLength-
  normalized `ghost-draw`) and the flecks surface behind its tip;
  pair with the `ghost-drift` class for the slow ambient float.

The hero landing choreography lives in globals.css (`.hero-mark` +
`.drop-land` + `.mark-land`): the drop falls with gravity easing,
squashes at impact (~220ms), the flecks splash upward
(`fleck-splash` on the independent `translate`/`scale` properties, so
it composes with the infinite evaporation loop's `transform`), and a
soft ink halo bleeds outward beneath the mark. At rest, hover lifts
the flecks and flares the ember — again via independent properties,
so the loop never pauses.

Props stay backwards-compatible (`size`, `breathe`, `className`;
`SealMark` is an exported alias) plus `variant`, `ink`, and `draw`.
Pure SVG, `aria-hidden`; it never carries meaning alone. Assets
regenerate from the same geometry via `scripts/gen-icons.ts` (sharp):
PWA icons, apple-touch, OG image.

### `sheet-grabber.tsx`

36×4px rounded mute bar, `aria-hidden`. "A fold in the paper, not a handle
that promises dragging" — mobile bottom sheets only.

### `theme-toggle.tsx`

Daylight/Nightfall switch. CSS decides which icon shows
(`dark:block` / `dark:hidden`) — zero hydration guesswork. After
hydration (a `useSyncExternalStore` check, no effect-setState), the
icon pair is keyed by the resolved theme, so a switch remounts the
span and the new icon swings in from a quarter-turn back
(`theme-turn`, 420ms).

### `sw-register.tsx`

Registers `/sw.js` after a 1.2s idle delay with `updateViaCache: "none"`;
failures are silent by design. The worker itself (public/sw.js) is
network-first for navigations, stale-while-revalidate for static assets
(now including `/legal/`), versioned caches, and **never** caches `/api/`
or socket traffic — installability without retention.

Update flow (Task 22): when a freshly deployed worker takes over
(`controllerchange` after a first controller existed, or the worker's
`cipherchat:updated` activate message), the page shows ONE persistent
sonner toast — "A fresh seal is ready" — with a Reload action and no
auto-reload: a half-written draft outranks freshness. Dev is exempt
(a caching worker and HMR serve each other stale chunks).

Notification taps (Task 25): the worker's `notificationclick` handler
focuses an existing window and posts `cipherchat:navigate {roomId}`
(or `clients.openWindow("/#/r/:id")` on cold start). This component
routes BOTH that message and the `cc:open-room` CustomEvent (from the
page-level notification fallback) to `navigate("chat", roomId)` — the
listeners stay attached in dev too, where they are inert.

### `notice-stack.tsx`

The in-app notification banner — the fix for "a notification enters and
overlaps the top of the screen." A banner NEVER covers anything: it is
in flow, at the top of the shell wrapper (`app.tsx` `Shell`), and the
whole app steps down as its grid track opens (`notice-open`, 0fr→1fr,
360ms). One banner per room (a room speaking again replaces in place
and resets its 6.5s clock); max three on stage; timers live in the
`store/notices.ts` zustand store, so remounts never freeze a banner.
Removal is a two-step bow: `dismiss` marks it leaving (the component
plays `notice-close`), `remove` takes it off stage on animationend.

The card: the writer's ink worn as a fleck (`InkMark variant="fleck"`
inside a colored circle), alias in the sender's ink, room name, and a
preview line that follows the notification preference. Tap (or Enter —
it is a real focusable `role="button"`) navigates to the room; X
dismisses. The stack is `sticky top-0 z-30`, claims the safe-area
padding only while non-empty, and publishes its live height as
`--cc-notice-h` via ResizeObserver — which `--toast-top` consumes so
toasts seat below it.

### `app-settings-sheet.tsx`

The device-level settings sheet (Task 25): Notifications and "On your
home screen" (install) plus the About rows. `AppSettingsButton` (the
bell) is the entry point, mounted on the desk header and the landing
header. The Notifications section walks the permission states —
default ("Allow notifications" → `requestNotifyPermission`), granted
(preview preference radio group: Full text / Sender only / Nothing +
a test notification), denied (quiet copy pointing at browser site
settings), unsupported (in-app banners still work). The Install
section is platform-aware via `useInstallPrompt`: `beforeinstallprompt`
captured → "Install app" (our UI asks, never the browser's mini-infobar);
iOS → the three-tap Share walkthrough; standalone → a check and silence.
Since Task 31 the About section also carries the abuse contact: a
Flag glyph + one quiet paragraph naming `abuse@cipherchat.app` (a
button that copies the address, "Address copied" toast) and stating
plainly what reporting does — "Reporting ends the room — it cannot
unsend anything, because nothing is kept."

### `apple-splash.tsx`

Server component rendering the 13 `apple-touch-startup-image` `<link>`s
(React 19 hoists them to `<head>`) for the installed iOS launch image —
generated by `scripts/gen-splash.ts` into `public/splash/` (105KB total).
See MOBILE.md for the full mobile pipeline.

### `legal-sheet.tsx`

The in-app reading surface for the legal documents. A tiny local zustand
store (`useLegalSheet`) drives it; `LegalLinks` renders the footer pair
("Terms of Use" / "Privacy Policy") and Settings → About opens the same
store. `LegalSheetHost` (mounted once in `app.tsx` beside the overlays)
fetches `/legal/{terms,privacy}.md` on first open (module-level cache),
renders via react-markdown with hand-styled elements — serif forest
headings, `max-w-prose` body, hairline rules, mono code — in the Sheet
primitive (bottom sheet `h-[92dvh]` on mobile, right sheet on desktop;
centered modals remain reserved for the burn moment). Loading is a mono
status line, errors get a retry. Single source of truth lives in
`public/legal/*.md`; the repo root has no duplicate.

---

## 8. Hooks

### `useIsDesktop(breakpoint = 768)`

MatchMedia listener (not a one-shot) — sheets flip between bottom (phone) and
right (desk) live on resize. Defaults false to match the mobile-first render.

### `useKeyboardInset()` — `hooks/use-keyboard-inset.ts`

Makes the on-screen keyboard visible to CSS. Mounted once in `CipherChatApp`.
Mechanics:

- Listens for `focusin`/`focusout` on any editable (input/textarea/select/
  contenteditable). **No editable focused → `--kb-inset` stays `0px`** —
  desktops, headless runs, and mobile URL-bar collapses never false-positive.
- While editing, computes the covered height with the standard
  visual-viewport formula:
  `layoutViewportHeight (documentElement.clientHeight) − visualViewport.height − visualViewport.offsetTop`,
  clamped to 0…60% of layout height, updated on `visualViewport` resize/scroll
  and window resize, rAF-batched.
- Focus hops between fields are handled by re-checking `activeElement` after a
  tick on `focusout`.
- Consumers: bottom sheets (`bottom-[var(--kb-inset,0px)]`,
  `max-h-[calc(100dvh-var(--kb-inset,0px))]`, 250ms transition) and the app
  shell (`pb-[var(--kb-inset,0px)]` — composer, typing strip, and message
  column rise; the scroll area shrinks to the visible viewport).
- Division of labor: **iOS** (overlays the page) is fully handled by the
  measured inset; **Android** is handled natively by the
  `interactive-widget=resizes-content` viewport meta (inset reads ~0 there) —
  the two mechanisms never double-count.

---

## 9. Styling system — `globals.css`

### Tokens

Two themes on one sheet: `:root` (Daylight: paper `#F4F1EB`, side `#EBE7DF`,
charcoal `#2C2A28`, forest `#3A4F41`/deep `#2B3D31`, terracotta `#C85A40`/
deep, ember `#E8A87C` **motion-only**, ash, hairline @8%) and `.dark`
(Nightfall: `#17181A` family, forest `#4A6453` — the same desk by lamplight,
not an inversion). Eight identity inks `--ink-0…7` (muted stationery hues;
no red, no neon) selected deterministically from key fingerprints.
`--kb-inset: 0px` defaults here. Full rationale in `DESIGN.md`.

### Typography classes

| Class | Face | Spec | Voice |
|---|---|---|---|
| `.t-display` | Lora 600 | 30/36 | Landing headline |
| `.t-title` | Lora 600 | 20/28 | Screen + sheet titles |
| `.t-body` | Lora 400 | 15.5/1.5 | Messages — letters, not data |
| `.t-label` | Inter 500 | 13 | Form labels |
| `.t-meta` | Inter 400 | 11px | Machine voice: time, counts, hints |
| `.t-fingerprint` | Plex Mono | grouped 4-4 | Codes and keys |

### Materials & effects

- `.bubble-self` / `.bubble-other` — forest-tinted vs. side-paper bubbles.
- `.spent-card` — view-once spent, ember ring at its edge.
- `.grain` — 2.8% fractal-noise paper texture, multiply, fixed overlay.
- `.scroll-quiet` — 4px warm scrollbar, dark variant included.
- `.composer-blur` — backdrop blur for the composer strip.
- `.shadow-float` — the single sanctioned soft shadow (cards stay flat;
  only floating surfaces cast).
- iOS input-zoom guard: `@supports (-webkit-touch-callout: none) and
  (pointer: coarse) { input, textarea, select { font-size: 16px } }`, unlayered
  to outrank Tailwind — kills Safari's focus-zoom on 15/15.5px fields.

### Motion

Keyframes: `mark-breathe` (the idle seal), `settle` (fade-rise entrances),
`rise` (bubble entrance), `seal-arc`/`seal-press` (S3), `msg-burn` (single
message), `char-close`/`char-veil`/`ember-rim`/`char-grain`/`burn-line-in`/
`burn-out` (S6 room), `dot-pulse` (status dots). Durations 150/250/400/600ms;
easing `cubic-bezier(0.2, 0, 0, 1)` — weight, never bounce.
`prefers-reduced-motion` collapses everything to 150ms fades (mandatory
override block at the end of the keyframe section).

---

## 10. shadcn/ui inventory

**Used by CipherChat** (restyled, in `components/ui/`):

- `sheet.tsx` — every sheet; bottom variant carries the keyboard-awareness
  geometry (§8).
- `dialog.tsx` — exactly one consumer: the burn-consequence modal.
- `context-menu.tsx` — message copy/burn menu (§4).
- `sonner.tsx` (`Toaster` in layout) — toasts, top-center, paper-styled.

**Available but unused** (stock scaffolding, safe to ignore or use later):
accordion, alert, alert-dialog, aspect-ratio, avatar, badge, button, calendar,
card, carousel, chart, checkbox, collapsible, command, drawer, dropdown-menu,
form, hover-card, input, input-otp, label, menubar, navigation-menu,
pagination, popover, progress, radio-group, resizable, scroll-area, select,
separator, sidebar, skeleton, slider, switch, table, tabs, textarea, toast,
toggle, toggle-group, tooltip.

House rule: prefer the `cc/` primitives (`actions`, `fields`) over raw shadcn
so the verb system and field language stay consistent.

---

## 11. Data layer

### `store/app.ts` — the orchestrator

One Zustand store holds all client state:

| State | Shape |
|---|---|
| `ready`, `seed` | Boot: the device seed (one random 32B; every room derives its own signing key from it) |
| `screen`, `activeRoomId`, `inviteCode` | Hash-router position |
| `roomCards` | The desk (persisted via `lib/local`) |
| `messages` | `Record<roomId, MessageView[]>` — memory only |
| `members`, `typing` | Live registries per room (identity authoritative only via REST) |
| `relayOnline`, `resealing` | Connection truths ("Re-sealing" = awaiting key delivery) |
| `sealing`, `burn` | Ceremony overlay triggers |

Actions (all UI mutations funnel through these): `init`, `navigate`,
`createRoom`, `joinRoom`/`enterRoom` (incl. the stale-rejoin bootstrap past
the server's rotation ledger), `sendMessage(text, file?, ttlOverride?,
reply?)` (sign → pad → encrypt → relay, optimistic — the reply snapshot rides
the frame and the optimistic view as `replyTo`; files become 1 meta + 44
uniform chunk frames), `emitTyping`
(throttled 2.5s, rides the same encrypted frames), `spendViewOnce`,
`burnMessage` (600ms choreography), `burnRoom`/`finishRoomBurn`, `leaveRoom`
(remaining members re-seal under a new random key), `renameRoom`,
`setDefaultTtl`, `markVerified`, `refreshMembers`.

Internals worth knowing: TTL burn timers and typing-prune timers live in
module memory (not state); sealing enforces `MIN_SEAL_MS`; the v2 receive
pipeline (`receiveFrame` → `RoomCipher.open`) enforces shape → registry
(eviction) → key version → **ECDSA signature** → **replay guard**, and only
then renders — forged or replayed traffic becomes either a quiet rejection
line (signature) or silence (everything else). Since round 29, both receive
paths (text and file-assembly completion) pass the verified reply through
`sanitizeReplySnapshot()` before it reaches the view. The store is a thin
adapter: every security decision lives in `lib/room-protocol.ts` where the
Task 19 test suite can reach it.

**Round 21 internals** — the silent-departure grace: a module-level
`silentGrace` timer map (one clock per offline member per room, 120s) is
armed by `member:presence(false)` and by the `room:state` honest-diff
(registry members absent from the relay's live list are marked offline —
this also fixes the stale away-dot after a refresh). When a clock expires,
only the still-connected coordinator acts (`fireSilentEviction` →
`stillSilentAtExpiry` gate → `POST /api/rooms/:id/evict` → announce
`member:expired`); both `member:left` and `member:expired` funnel through
`confirmDeparture()` — REST-confirmed eviction, system line (`left.` vs
`drifted away.`), coordinator rotation. `init()` is guarded by a
synchronous `initStarted` flag (the `ready` check alone has an await gap
that once let handlers register twice). Composer drafts live in
`lib/drafts.ts` (memory-only, per-room).

### `lib/` modules

| Module | Role |
|---|---|
| `protocol.ts` | **Wire protocol v2**: frame types, uniform padding (control 20480+16B, file chunks 65536+16B, fixed-count file transfers), canonical v2 signing string, seal/open, replay guard (counters + session tags + ±10min window + id dedup + persistable watermarks), send clock, session ECDH helpers. **Round 29**: `FrameBody.reply` + exported `replyCanonical()` — the reply snapshot is the canonical string's 12th field, so a quote is signature-covered like the words themselves |
| `room-protocol.ts` | **`RoomCipher`** — the per-room security engine: versioned key ring with grace, registry eviction gate, rotation ceremony (`rotateTo`/`rotateAsCoordinator`), join-key delivery (double-wrapped offers), pending buffer, file-chunk assembly with sha verification, key-version cap. **Round 29**: `sealText`/`sealFile` accept a `reply` snapshot, the file-assembly map carries it, the completed-file OpenResult hands it to the store, and `open()` verifies the **raw** snapshot — sanitising happens only after the signature has bound the bytes |
| `kdf.ts` | argon2id (64 MB, t=3, p=1) versioned key bundles; legacy PBKDF2 room unlock |
| `room-identity.ts` | Per-room ECDSA keys derived from the device seed via HKDF(seed, roomId) — cross-room unlinkability |
| `crypto.ts` | Legacy v1 primitives (PBKDF2 room keys, verifier blobs, canonical-JSON sign/verify, base64) — still the sign/verify backbone |
| `legacy.ts` | PBKDF2 epoch-key cache for pre-v2 rooms (the legacy receive path is gated to them) |
| `rate-limit.ts` | Token bucket (20 frames/s per socket), IP limiter (5 rooms/min), frame-size cap — shared by relay and API |
| `silent-grace.ts` | **Round 21**: the silent-departure decision logic — `SILENT_GRACE_MS` (120s client clock), `EVICT_MIN_OFFLINE_MS` (60s server floor), `authorizeEviction` (pure; the /evict route obeys), `stillSilentAtExpiry` (pure; the client's gate at timer expiry) |
| `drafts.ts` | Per-room composer drafts — memory-only, like the keys |
| `identity.ts` | Deterministic aliases ("Quiet Heron") and ink indexes from fingerprints; 8-hex fingerprints + `3F2A · 91BC` grouping; passphrase generator (CSPRNG, 256-word list, 6 words = 48 bits — see DESIGN.md §5); room-code parser |
| `media.ts` | Image-metadata gate for the attach path: `imageNeedsScan` (scope: jpeg/png/webp — SVG and GIF pass by policy), `imageHasMetadata` (pure byte-level detector: JPEG APP1-Exif/APP1-XMP/COM incl. FF-fill tolerance, PNG eXIf/tEXt/iTXt/zTXt/tIME, WebP EXIF/XMP; unparseable image bytes flag suspect), `reencodeImage` (browser canvas decode→draw→encode, q0.92 for lossy formats, null on failure) |
| `session.ts` | **Memory-only** room sessions (member ids, kv, the password — kept while the room is open so the invite sheet can re-share it; never on disk; refresh = locked rooms, by design) |
| `local.ts` | localStorage: room cards, creator tokens, verify marks, replay watermarks, TTL-hint flag, per-room settings |
| `relay.ts` | The single socket.io client (`io("/?XTransformPort=3003")`) |
| `types.ts` | `MessageView` (round 29: `replyTo?: ReplySnapshot`), `RoomCard`, `MemberPublic` (incl. `ecdhPub`), legacy `WireEnvelope`, TTL steps, `Screen`. **Round 29**: `ReplySnapshot {id, senderId, snippet, file?}`, `REPLY_SNIPPET_MAX = 120`, `makeReplySnapshot()` (compose-time quote — "Sealed message" for view-once targets, file name + `file: true` for files, whitespace-collapsed 120-char text), `sanitizeReplySnapshot()` (post-verification UI gate: 64/64/160 caps, malformed shapes dropped), `isReplySnapshot()` shape guard |
| `format.ts` | `fmtTime`, `fmtAgo`, `fmtTtlRemaining`, `fmtBytes` |
| `db.ts` | Prisma client (server-side only) |
| `__tests__/` | **The property suite** — tests named after the security properties they protect: task-19 (47: replay, rotation, padding, KDF, identity, hardening), task-20 (11: file captions, ink reactions), task-21.1 (16: silent-grace decisions), task-22 (leave-proof, admission, identity-range), task-25 (16: notifications), **task-29 (16: reply round-trips on text and through file assembly, tampered-quote signature break, size-indistinguishability, replay refusal, replyCanonical determinism, snapshot make/sanitize hygiene, viewer classification, CSV parsing)** — 124 cases total |

### Backend surface (for reference)

REST: `POST /api/rooms` (rate-limited 5/min/IP) · `GET /api/rooms/:id` ·
`PUT verifier` (set-once) · `POST/GET members` (cap 12; carries `ecdhPub`;
**the only identity authority** — keyed by pubkey) · `POST leave` (epoch
ledger bump) · `POST evict` (round 21 — silent-leaver write-out: consults
the relay presence snapshot server-to-server, fails closed; 30/min/IP) ·
`POST burn` (creatorToken). Relay (socket.io, port 3003, in-memory,
hardened): `room:join`, `message:send`/`message:ack`
(uniform v2 frames), `member:joined`/`member:left`/`member:presence`/
`member:expired`, `key:request`, `room:burn` — plus legacy
`message:spent`/`member:typing`/`message:burn` forwarding for pre-v2
clients. Per-socket token bucket
(20 frames/s sustained, burst 64), hard frame-size cap with disconnect,
16-room cap. **Internal presence snapshot** (round 21): port 3004,
`GET /presence/:roomId`, guarded by the shared `RELAY_INTERNAL_TOKEN`
header — the connection authority `/evict` consults; not routed through
the gateway. The relay stamps `wentOfflineAt` on every silent last-socket
drop (the grace clock) and clears it on any return. The relay never
touches the database — new joiners see no history because none exists.

---

## 12. Conventions checklist

When adding a component, it must obey:

1. One primary verb per surface; forest means trust, terracotta means
   destruction/impermanence — never anything else.
2. Lora is the human voice (messages, names, titles); Inter is the machine
   (UI, labels, meta); Plex Mono is for codes.
3. Errors are neutral charcoal, inline, `role="alert"`, no exclamation marks.
4. No card shadows; hairline borders; radius 4/8/12/18; 44px minimum touch
   targets (48px primary buttons).
5. Irreversible actions require the centered consequence modal; everything
   else uses sheets.
6. Never persist messages or keys — localStorage holds cards, tokens, marks,
   settings only.
7. Empty states are product statements, not apologies.
8. New bottom sheets get `SheetGrabber` on mobile, keyboard-aware geometry
   comes free from the shared `SheetContent` bottom variant, and content must
   scroll internally (`overflow-y-auto overscroll-contain scroll-quiet`).
9. Respect `prefers-reduced-motion` — entrances become 150ms fades.
10. The only security glyph is the shield that opens verification. The lock
    glyph means one thing: a locked room.
