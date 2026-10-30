# CipherChat, component reference

Every component in the app, what it does, how it works, and the rules it
obeys. Companion to `DESIGN.md` for tokens and rationale, and
`worklog.md` for the build history.

How to read this: sections follow the layers of the app. shell, screens,
chat surface, sheets, ceremony overlays, primitives, hooks, styling
system, shadcn inventory, data layer. Each entry lists its file, its spec
screen (S1 to S9 from the product brief), its props and API, its states,
and the mechanics that make it interesting.

---

## 1. Architecture at a glance

```
src/
├── app/
│   ├── page.tsx              # the ONLY route, "/", renders <CipherChatApp/>
│   ├── layout.tsx            # fonts, ThemeProvider, Toaster, grain, SW, viewport
│   └── globals.css           # tokens, type classes, keyframes, keyboard CSS
├── components/
│   ├── cc/                   # CipherChat product components, the real library
│   ├── screens/              # page-level screens, S1 S2 S4 S5/S8
│   └── ui/                   # shadcn/ui primitives, mostly untouched stock
├── hooks/                    # useIsDesktop, useKeyboardInset
├── lib/                      # crypto, identity, session, local, relay, format, types
└── store/                    # the Zustand orchestrator, the app's brain, in slices
```

One route, four screens. There is no Next.js routing past `/`. Routing
is a hash router driven by the store: `#/` for the landing, `#/join/:code`
for an invite, `#/rooms` for the desk, `#/r/:roomId` for a chat. Invite
links arrive as `/?join=CODE` and are rewritten to `#/join/…` on boot.

Three layers of components:

| Layer | Directory | Role |
|---|---|---|
| Screens | `components/screens/` | Own a viewport, map 1:1 to spec screens S1 to S8 |
| Product components | `components/cc/` | Reusable surfaces inside screens, composer, bubbles, sheets |
| Primitives | `components/ui/` | shadcn/ui. Only Sheet, Dialog, ContextMenu and Sonner are used. The rest is stock scaffolding. |

Data flow. Everything user-visible comes out of one Zustand store,
`store/app.ts`, assembled from the slices beside it. Components subscribe with atomic selectors,
`useApp((s) => s.messages[roomId])`, never hold server state locally, and
call store actions for every mutation. Secrets, meaning room keys and
passwords, never enter the store. They live in the module memory of
`lib/session.ts` and a refresh wipes them. Quoted-reply snapshots,
`MessageView.replyTo`, are data rather than secrets, because they are
copies of words the room has already been shown.

Server model. REST, `app/api/rooms/*`, handles room lifecycle only. A
socket.io mini-service on port 3003, `lib/relay.ts` to
`io("/?XTransformPort=3003")`, relays encrypted envelopes and presence in
memory. Neither ever sees plaintext.

---

## 2. App shell

### `CipherChatApp`, `components/cc/app.tsx`

The root client component. Its jobs:

1. Boot. Calls `init()`, which loads the device identity, the room cards
   and the hash route.
2. Keyboard awareness. Mounts `useKeyboardInset()` once, publishing
   `--kb-inset` for every sheet and the shell. See §8.
3. Invite deep-link. Reads `?join=CODE` and rewrites it to `#/join/:code`.
4. Screen routing. `<Screens/>` picks the active screen from store state.
5. Global overlays. `<SealingOverlay/>` and `<BurnOverlay/>` sit above
   everything when the store says so.

The desk and room layout, everything that is not the landing, is a flex
`h-dvh` shell.

- `pb-[var(--kb-inset,0px)]`. The whole shell rises above the mobile
  keyboard.
- Sidebar. `w-full` on mobile, `w-[320px]` plus a hairline border from
  `md:` up, and hidden on mobile while a room is open, `hidden md:block`,
  iMessage style.
- Desktop with no room open shows the low-key placeholder, the seal plus
  "Open a letter, or start a new one."

### `page.tsx` and `layout.tsx`, `src/app/`

`page.tsx` is 14 lines: Suspense for `useSearchParams`, plus
`<CipherChatApp/>`. `layout.tsx` loads the three typefaces through
`next/font` as CSS variables `--font-lora`, `--font-inter` and
`--font-plex-mono`, mounts `ThemeProvider` (next-themes, class strategy,
light default), the Sonner toaster top-center, the full-viewport paper
grain `<div className="grain"/>`, and `SwRegister`. The viewport export
sets `viewportFit: cover` for safe areas and
`interactive-widget: resizes-content` for Android keyboard behaviour.

---

## 3. Screens

### `LandingScreen`, `screens/landing.tsx`, S1

The five-second decision surface. Seal breathing, which is the app's one
intentional idle loop. One display headline, "A conversation that leaves
no trace." Two actions: Create a room as the forest primary, Join with a
link or code as secondary. Plus a low-key "Back to your rooms" escape that
only exists when rooms exist. The footer carries the trust line.

`[@media(max-height:720px)]` compaction keeps everything above the fold on
short screens. `ThemeToggle` lives in the header.

The footer line reads "Messages are encrypted in your browser. Set them to
disappear on a timer if you want. We can't read them." It used to say
"destroyed on schedule" and "Neither can anyone else", which overclaimed
twice: TTL is off by default, and room members can read everything. See
bugs/BUGS.md B34.

**`CreateRoomSheet`**, internal. A bottom sheet on mobile, always
`side="bottom"`, with the grabber showing on touch. Two fields: room name,
a private label capped at 60, and a password pre-seeded with a generated
passphrase. `generatePassphrase()` picks six words with a CSPRNG from a
256-entry list, which is 48 bits, see DESIGN.md §5. A "New password" quiet
action refreshes it. The field masks by default, `PasswordField` with an
eye toggle to reveal.

The passphrase is never React state. It is seeded straight into the
field's DOM property when the sheet opens, re-seeded by the refresh
action, read once at submit, wiped on success, and dies with the input
node when the sheet unmounts. The DOM `value` attribute is never written,
so the Elements panel shows no value on this field for its whole life.

Submitting calls `createRoom(name, password)`. On success it closes and
toasts the standing advice, "Share the link, and the password through a
different channel." The error state is neutral charcoal, never
terracotta.

The "New password" button is a text-sized control around 17px tall, which
is under the 44px the design system promises. See bugs/BUGS.md B27.

### `InviteScreen`, `screens/invite.tsx`, S2

Where a stranger lands from a shared link. The order of information is
fixed by spec: reassurance headline, then room code, prefilled when
arriving via `?join=` and formatted `ABCDE-FGHIJ` with a hidden input
when prefilled, then the password, then Enter.

Below that, a collapsed "What happens next" disclosure, a grid-rows 0fr to
1fr animation, with three facts: encrypted in browser, nothing stored,
creator can burn.

States: default, busy ("Entering"), wrong password (inline and neutral,
"That password doesn't match this room."), room gone ("This room doesn't
exist, or it has been burned.", which also marks the local card as ash),
and room full. `reasonCopy()` maps every `JoinResult.reason` to calm copy.
There are no exclamation marks anywhere in the product.

### `RoomListColumn`, `screens/room-list.tsx`, S4

The desk. One component serves both breakpoints: full screen on mobile,
320px sidebar on desktop. The header has the title, a low-emphasis `+` New
room icon button, and the ThemeToggle. The footer has an underlined
"Have an invite link? Join a room".

**`RoomListBody`** renders one of four states:

| State | Render |
|---|---|
| Empty desk | Seal plus "No rooms yet." plus Create and Join actions. The empty state is a product statement. |
| All locked | A hint line: "Rooms lock when you refresh: re-enter each password to return." |
| Mixed | Same hint, shown when at least one room is locked |
| Burned | Ash cards, below, cleared from storage on the next full reload |

**`RoomCardRow`**, one letter on the desk. Shows the local name, never
corrected across members, the member count, `fmtAgo` last activity, and a
forest unread dot seated on the name's x-height. Hover is a paper lift,
`-translate-y-px` plus a forest border. An open room takes a forest/30
border and a wash. Locked cards sleep: no lift, a lock glyph, muted meta,
and the lock means the locked state, not the security badge. Burned cards
render as dashed ash with a −2° strikethrough and a mail glyph,
`aria-disabled`, gone after a reload.

There is also an unread count pill on the card, capped at "99+", and a
launcher badge that sums unread counts. DESIGN.md used to say no counts
and no badges. See bugs/BUGS.md B36.

**`UnlockSheet`**, exported. Re-enters a locked room: password, then
`joinRoom`, then the S3 seal, then chat. Same neutral error mapping as S2.

It awaits `joinRoom()` with no `try/catch`, unlike the create and invite
forms, so a transport error leaves the sheet permanently busy. See
bugs/BUGS.md B24.

### `ChatScreen`, `screens/chat.tsx`, S5/S8 plus the locked state

The room. The first render checks `getSession(roomId)`, and no session
means locked, which is a first-class state and never an error.

**`LockedRoomView`**: a centered card with a lock tile, the room name, the
key-truth copy ("Keys live only in memory, re-enter the password to
return."), a password field, Unlock, and a back action. The header buttons
toast "Unlock the room first".

With a live session, **`ActiveRoom`** assembles the room:

- `ChatHeader`, below.
- The message scroll area. `role="log"` with `aria-live="polite"`, the
  `.scroll-quiet` scrollbar, a `max-w-[720px]` column. It auto-scrolls to
  newest on arrival unless the user is scrolled up more than 220px, in
  which case the jump pill counts what arrived below the fold, "3 new
  messages" with a forest dot, or "Latest" with a chevron. Self and system
  messages always auto-scroll.
- **Empty states, S8.** The creator alone gets the invitation moment,
  Copy invite link or Show the password. A joiner gets the product
  statement: "You won't see messages from before you joined. That's how
  this works."
- **`TimeAwareMessages`** walks the grouped messages and inserts a small
  timestamp divider when the gap exceeds 30 minutes, "17:04" or
  "Wed · 17:04", `role="separator"`.
- **`TypingLine`**, a reserved 26px strip above the composer so the space
  is always there and nothing jumps. It renders the whisper: "Velvet Owl
  is writing…", "A and B are writing…", "Several people are writing…",
  with aliases in their ink colors and `aria-live="polite"`.
- **TTL hint strip**. One-time, 10s, dismissible, explaining expiry:
  "Messages set to expire burn themselves when the clock runs out, for
  everyone." Shown the first time a TTL is armed in a room whose default
  is 0.
- `Composer`, then the three sheets and `FileViewer`.

State handling note: room-prop changes, meaning switching rooms, use the
sanctioned render-time adjustment pattern,
`if (roomId !== hintRoomChecked) setState…`. No effects for derived state.

**Round 29 state.** `replyTarget`, the message being answered, and
`viewing`, the file open in the viewer. Both are memory-only like
everything else. Both are released by the same render-time pattern when
their message burns, because a letter that burns while being read must not
linger on screen and you cannot answer what is no longer here.
`jumpToMessage(id)` finds the row via
`[data-mid="${CSS.escape(id)}"]`, scrolls it to the center, and restarts
the `quote-flash` pulse, class remove then forced reflow then add, so
repeated jumps re-announce. A target that is gone toasts "That message is
no longer in this session" instead. `beginReply` seats the quote and
closes the viewer if one is open. The window-level Escape guard steps
aside while a reply is pending.

---

## 4. Chat surface

### `ChatHeader`, `cc/chat-header.tsx`

Room name in Lora, with a native `title` tooltip revealing the full name.
Member count and offline pulse in Inter meta. Exactly three icon buttons,
all 44px, all with press-in active states: Share invite (Link2), Verify
participants (the Shield, the only security glyph in the app), and Room
settings (Settings2). The back chevron is mobile only. Sticky and
safe-area aware, `pt-[env(safe-area-inset-top)]`.

### `Composer`, `cc/composer.tsx`

The writing surface, and the most stateful leaf component. A sticky
`composer-blur` strip, backdrop blur, one of exactly two blurred surfaces.

| Element | Behaviour |
|---|---|
| Textarea | Auto-grows 1 to 3 lines, 24 to 66px. Lora 15.5px. Enter sends, Shift+Enter makes a newline. `maxLength 4000`. |
| Attach, the paperclip | A hidden `<input type=file>`, capped at 2MB (`FILE_LIMIT`), base64-encoded in 8KB chunks. Images are scanned first, see `lib/media.ts`: a byte-level detector looks for EXIF, XMP and comment segments, JPEG APP1 and COM, PNG eXIf and text chunks, WebP EXIF and XMP. Clean files pass through untouched. Files that carry metadata are re-encoded through a canvas, JPEG and WebP at q0.92 and PNG losslessly, and it is the re-encoded bytes that attach. The slip shows the new size. Fail-closed: a metadata-carrying image that cannot be re-encoded is refused with a notice, never attached as-is. SVG and GIF pass through by scope, see DESIGN.md §5. |
| Drag and drop | A dashed forest "Release to attach" overlay while hovering |
| Paste | Clipboard files into the textarea attach instead of inserting |
| TTL chip | Cycles OFF to 5m to 1h to 8h. The armed state is terracotta. The first-ever arming raises the hint strip instead of a toast. |
| Attachment slip | A paper tile, name and size, a View once toggle, and remove. The small chips get expanded hit areas. |
| Reply slip, round 29 | The quoted words above the input, alias plus snippet plus X to cancel. Beginning a reply focuses the input, touch included, because the reply is an intent to write. Submitting encrypts the quote snapshot into the message, with `makeReplySnapshot` at send time so the quote is exactly what was on screen. Escape releases the quote first, and `stopPropagation` keeps the window-level escape-to-rooms handler from seeing the key. |
| Send | A forest circle with an arrow, disabled unless there is text or an attachment |
| Offline | The send button is replaced by a status chip, "Reconnecting" when the relay is down or "Re-sealing" during a key rotation after someone left. You never type into a void silently. |
| Near limit | "N characters left" appears under 200 remaining. At zero, calm terracotta copy: "…as long as a letter can be". |

State is keyed per room, `<Composer key={roomId}>`, with the TTL seeded
from the room's local default. Sending is optimistic: text clears
instantly, focus is kept, the store handles sign, encrypt and relay, and
the bubble shows "Sending" at 60% opacity with a pulsing dot until the ack.

This file carries the two remaining lint warnings, an unused expression at
line 159 and an unused eslint-disable directive at line 161. See
bugs/BUGS.md B40.

### `bubble.tsx`, messages

**`useMessageGroups(messages)`**. A pure hook that computes
`BubblePosition`, `first`, `last` or `showTime`, for every message.
Consecutive messages from the same sender within 3 minutes collapse into a
group, the alias shows on `first` and the timestamp on `last`. System
lines break groups.

**`MessageBubble`**. Self is right-aligned on `.bubble-self`, forest-tinted
paper. Others are left on `.bubble-other` with the sender's ink dot and
alias in `var(--ink-N)`. The corner language is an 18px radius collapsing
to 6px on the corners nearest the sender, the group-internal edges. Max
width 75%. The entrance is the `rise` keyframe. States: sending at 60%
opacity, then sent, then `burning` through `msg-burning`, an ember-rim
glow into the 600ms dissolve, handled by the store's burn choreography.
File messages render the caption, `message.text`, as `t-body` above the
file card. The caption rides the meta frame's signed text field, so it
is exactly as authentic as a text message. Under protocol v3 the rest of
the file's metadata is signed too, the name, the mime, the size, the
hash, the ttl and the view-once flag. A reply renders its
**`QuoteBlock`** inside the bubble, above the body. Every row carries
`data-mid={message.id}`, the jump target.

Three roads to the same verb, round 29: a hover-only reply icon button
beside the bubble on desktop, a `group/row` opacity transition,
`-left-10` for self and `-right-10` for others, which is a mouse thing and
touch uses press-and-hold; the context menu's Reply item; and a
double-click on the bubble itself.

**`QuoteBlock`**. The strip of the message being answered, a small letter
inside the letter. A 2px left border in the quoted sender's own ink,
`var(--ink-N)`, "Someone" in mute if they have left and "You" if it is
you. Alias plus snippet, and a `FileText` glyph when the quoted message
carried a file. The snippet is a copy the reply itself carries, so the
quote survives the original burning, because the words were already shown
to the room. Clicking jumps to the original while it lives in session
memory. It is a real focusable button and its `aria-label` tells the truth
either way: "Jump to the original" or "The original is no longer in this
session".

**`CopyMenu`**. A Radix ContextMenu wrapping every bubble, right-click on
desktop and press-and-hold on touch. Items: Reply, first when a reply
handler is wired, round 29. Copy text, Copy caption for file messages with
a caption, or Copy file name, each toasting. Mark this message, a submenu
with the four ink marks, ✓ Acknowledged, ✦ Noted, ♥ Warmly received, ☾
Later, which is `REACTION_MARKS` in `lib/types.ts`, with the one you
currently hold flagged by a forest dot. And Burn message, for your own
sent messages only, a two-step arm inside the menu where the first press
turns the item terracotta and re-labels it "Burn for everyone" and the
second press executes. Styled as paper: 12px radius, a hairline, and a
single soft shadow through an arbitrary value, which beats shadcn's
layered `shadow-md`.

**`MarksBar`**. The ink-mark chips under a bubble, one pill per mark, a
serif glyph plus a tabular count, entering on `.mark-chip` with a beat on
`.mark-count`. Pressed state when you hold the mark, forest-tinted.
Clicking a chip toggles your own mark on and off. `title` and `aria-label`
name who marked. Marks resolve memberIds to live aliases at render time,
with a "Someone who left" fallback. On the wire, `sealReact` frames carry
the mark glyph in the signed `text` field and the target in
`messageId`, see `room-protocol.ts`. One mark per sender per message, and
the toggle transition is applied identically by the optimistic local
update and by every receiver.

**`TtlRemaining`**. A ticking countdown on a 1s interval with a
terracotta hourglass glyph and `tabular-nums` so the meta row never
jitters. The label comes from `fmtTtlRemaining`, "4:59" down to "moments".

This countdown sits inside the message log's `aria-live="polite"` region,
so a screen reader may re-announce a changing number every second, per
expiring message. See bugs/BUGS.md B26.

**`FileContent`**. The file presentations. Round 29 made opening every
card's job, so downloading is a choice the viewer offers rather than the
card's whole job.

- View-once sealed: a paper card with a mail glyph reading "Sealed, view
  once, opening destroys it". It opens `FileViewer`.
- View-once spent: `.spent-card` with an ember rim reading "Opened - the
  contents are gone". It never re-opens, and that is enforced server-side
  too, since spent IDs are broadcast.
- Images: an inline base64 `img` at `max-h-56`, click to open the viewer.
- Video, audio and other files: an open-in-the-viewer card. A file tile
  wearing the kind's glyph, Film for video, Music for audio, FileText
  otherwise, the kind label ("Video", "Audio", "File"), the name, the
  size, and an Eye glyph that warms to forest on hover. Nothing downloads
  directly.

**`downloadFile(name, mime, dataB64)`**, exported. Base64 to Blob to
object URL to synthetic anchor click, then revoke after 4s. Toast on
success or failure. Since round 29 its only caller is the viewer's
Download button, and the cards never call it.

**`SystemLine`**. Low-contrast centered meta text: "Quiet Heron joined."
or "A message claiming to be from X was rejected: signature invalid."
System lines are `kind: "system"` messages and they never carry identity.

### `FileViewer`, `cc/file-viewer.tsx`

A full surface, not a modal, because centered modals are reserved for
irreversible moments. A fixed overlay of `bg-paper/95` plus 16px blur, the
second blurred surface, with `role="dialog"` and `aria-modal="false"`, so
the room stays alive behind it. Round 29 rewrote it: every file opens in
the app now, with no forced downloads and nothing handed to the browser's
own viewer.

The focus contract is incomplete. The viewer does not move focus into
itself, does not trap it, and does not restore it to the triggering
message. A keyboard user can tab behind the overlay into the
conversation. See bugs/BUGS.md B25.

**Classification**. Exported as `classifyFile(mime, name)`, routing by mime
first and then by extension: `image/*` to image, `video/*` to video,
`audio/*` to audio, `application/pdf` or `.pdf` to pdf, `text/csv` or
`.csv` to csv, text-ish mimes plus a `TEXT_EXTS` allowlist covering code,
config and markdown to text, and everything else to binary.

**Blob lifecycle**. The base64 decodes once to a `Uint8Array` in memory. A
single object URL is created in an effect keyed on the message id and
revoked in its cleanup, `URL.revokeObjectURL`, on switch or unmount.
Nothing is fetched and nothing is written. When the viewed message
changes, or the viewer closes, zoom, wrap and the decoded bytes reset
through a guarded render-time adjustment on a `viewingId` state, the
sanctioned no-effect pattern, so a departing file's plaintext leaves React
state the instant it is no longer on screen, and the effect itself only
creates and revokes. The viewing copy was taken at open time, so a message
burning behind the viewer does not yank the bytes, and the chat screen
closes the viewer when its message goes.

Per type:

- Image: contained. Click, Enter or Space toggles 220% zoom,
  `cursor-zoom-in/out`, a focus ring, a keyboard-operable `role="button"`
  img, and the same behaviour as always now fed from the blob.
- Video: `<video controls playsInline
  controlsList="nodownload noremoteplayback">`. View-once also disables
  picture-in-picture and suppresses the context menu.
- Audio: a styled card, a music glyph in a forest circle, name, size, with
  the same `controlsList`.
- PDF: rendered by pdfjs-dist v6 onto a `<canvas>`. The worker is vendored
  at `public/pdf.worker.min.mjs` and served from `/pdf.worker.min.mjs`, a
  static asset that eslint ignores as vendored. devicePixelRatio-aware
  scaling capped at 2×, fit-to-width, Back and Next page navigation, and
  "Page x of y". A canvas carries no browser PDF toolbar and no save
  button, which is the point. pdf.js transfers buffers, so it is handed
  `bytes.slice()`, a copy, and our bytes stay ours. If pdf.js fails to
  load the document, regular files fall back to an `<iframe>` with the
  blob URL, but view-once files stay unopened. The notice says falling
  back would expose the browser PDF toolbar's save button, and asks the
  sender to re-share. A page that fails to render sets a failed state,
  never a blank canvas.
- Text: escaped plain text in a monospace `pre`, React escaping and never
  innerHTML, a wrap toggle, and `TEXT_SHOW_MAX = 100_000` as the on-screen
  cap, since "copy takes the whole file". HTML files carry the label
  "Shown as source - HTML is never executed here". SVG renders in an
  `<img>` context, where its scripts cannot run.
- CSV: `parseCsv()`, exported, pure and quote-aware in an RFC-4180 style,
  so doubled quotes, commas and newlines inside quoted fields and CRLF are
  all tolerated and empty rows are dropped, into a sticky-header table
  capped at 500 rows by 32 columns, `CSV_MAX_ROWS` and `CSV_MAX_COLS`.
  Wide rows are clipped and copy takes the whole file.
- Binary: a metadata card, name, size, "inspected in memory", plus a hex
  dump of the first 512 bytes, with offset, hex and an ASCII gutter.

Header row: name, size, mime, and a "view once" marker. Buttons: Copy
contents for text-ish files, which copies the whole file, Download, which
is present only for non-view-once files, and Close. A view-once file has
no download anywhere, not on the card and not in the viewer, and the
affordance is stated outright beneath the header, a circled "1" badge with
the two-word line "View once".

View-once spending happens the instant the viewer opens. `onSpent` fires
on `message.id` change, and the bubble becomes the spent card behind the
viewer simultaneously for everyone in the room.

Escape closes. Body scroll lock is not needed, since the overlay is fixed.

**Chat keyboard layer**, `screens/chat.tsx`. Escape with an empty composer
returns to the room list. Sheets, menus, dialogs and the file viewer own
the key first, and `[data-state="open"]` or `[role="dialog"]` is checked
besides. A reply in progress owns it before all of that, since the
composer's own keydown releases the quote and stops propagation. A
composer holding words never loses them to a stray Escape.
**`TypingLine`** carries three `.typing-dot` ink dots, aria-hidden and
staggered 180ms, before the aria-live sentence. **`ChatHeader`** renders
per-member presence dots in each member's own ink, entering on `.dot-in`,
with away members resting at 35% opacity, before the member count.

---

## 5. Sheets

All sheets share one skeleton: the shadcn `Sheet`, Radix Dialog
underneath, with `side={isDesktop ? "right" : "bottom"}`, a `SheetGrabber`
on mobile, and the keyboard-aware geometry from §8, meaning
`bottom-[var(--kb-inset)]`, a capped `max-h`, and internal `scroll-quiet`
scrolling. Desktop sheets are right-side, 440px, rounded-left 18px.

| Sheet | File | Spec | Opens from |
|---|---|---|---|
| `CreateRoomSheet` | `screens/landing.tsx` | S1 | Landing, Create a room |
| `UnlockSheet` | `screens/room-list.tsx` | S4 | A locked room card |
| `InviteSheet` | `cc/invite-sheet.tsx` | S5 | Header link icon, and auto-opens once after room creation |
| `VerificationSheet` | `cc/verification-sheet.tsx` | S7 | Header shield |
| `SettingsSheet` | `cc/settings-sheet.tsx` | S9 | Header settings icon |

### `InviteSheet`

The link plus the password, with the standing advice. Layout: label rows
carry their actions, Copy on the link, Show and Hide plus Copy on the
password, so the value boxes stay full-width `break-all` mono and long
passphrases never wrap the layout. The password reveals with `select-all`
for manual copying. Below, the in-person block: a 108px QR of the invite
link, generated client-side through `qrcode`, charcoal on daylight paper
always light in both themes, because a code is a physical object and
scanners agree, with the reminder that the password still travels
separately.

Auto-open rule: after creating a room, the invite opens once per room,
tracked in `sessionStorage cc.inviteShown.<roomId>`, which is the natural
next verb.

### `VerificationSheet`, S7

The hardest security-UX problem, made one-tap. One row per member: the ink
dot, the alias in that member's ink, the 8-hex fingerprint in mono grouped
`3F2A · 91BC`, a copy button with an expanded hit area, and a manual
verify switch, `role="switch"`. Self is marked "· you" with no switch.
Fingerprints are computed asynchronously from each member's public key
through `keyFingerprint`, deterministic and identical for every viewer,
with a `···· ····` placeholder while pending. Verified marks persist per
room in localStorage, `lib/local.ts`, and also show as forest checks in
Settings.

Footer: the "What is a fingerprint?" glossary, a grid-rows disclosure
that gives a one-tap explanation of MITM checking without the word MITM.

8 hex characters is 32 bits, which is on the low side for something people
are asked to compare out loud over another channel. See bugs/BUGS.md B31.

### `SettingsSheet`, S9

Local-only settings, ordered by weight. Room name, a private label with
the note "Others may label this room differently. CipherChat never
corrects this." Default message lifetime, a 4-cell segmented radio group
of Off, 5m, 1h and 8h, forest when selected. People here, the ink dot,
alias, verified checks and "· you".

Then whitespace rather than a header, and the exit: Burn this room for the
creator, terracotta, or Leave room for a member, secondary, each with its
consequence line, "Burning destroys the room for everyone,
unrecoverably." and "When you leave, those who stay re-seal the room under
a new key you will never receive."

**No abuse report.** Round 32 put a Report this room row below Leave,
signed with the member's room key, and it went in the same pass that
took protocol v3. The server holds no content, so a report could only
ever end the room, and the ways to end a room were reachable by anyone
holding an invite link. The graded version looked safe because a report
needed a signature from a registered key, but registering took no proof
of anything. The feature went: no row, no modal, no store action, no
route, no proof module. What is left in the sheet is the exit, Burn
this room for the creator and Leave room for a member, and the room
ends when its clock runs out too.

Burning opens the app's only other centered modal, a shadcn Dialog:
"Burn this room? This destroys the room and its messages for everyone.
This cannot be undone.", followed by Burn the room, terracotta with a busy
state, or Cancel. The creator token lives in localStorage,
`lib/local.ts`, so a creator can still burn after a refresh, and the
server keeps only its hash. A refusal from the server raises a toast and
leaves the room open, so a live room never shows a burn screen it did
not get. See bugs/BUGS.md B22 and B20, fixed.

Fields re-seed through the render-time pattern whenever the sheet
re-opens.

---

## 6. Ceremony overlays

These are the two moments the product is named for. Both are
full-viewport, z-70 and z-80, driven entirely by store state.

### `SealingOverlay` and `Sealing`, `cc/sealing.tsx`, S3

The key-derivation moment: a seal-press animation, not a spinner. A 96px
circular SVG with a hairline track and a forest arc that fills over 1700ms
on `cubic-bezier(0.2,0,0,1)`, `seal-arc`, plus a `seal-press` scale-weight
on the whole dial, with the SealMark centered inside. Copy: "Sealing the
room" and "Deriving your encryption keys. This takes a moment on purpose."
The slowness is real, since argon2id with 64MB of memory hardness
genuinely takes a moment, and the store enforces `MIN_SEAL_MS = 1700` so
the animation never finishes before the crypto does. `role="status"` with
`aria-live="polite"`.

The inner `Sealing` component is reusable with a custom label and sub. The
store's `sealing: SealingState | null` drives the wired version, which is
also used while a rejoined member awaits key delivery, and that is the
composer's "Re-sealing" chip.

### `BurnOverlay`, `cc/burn-overlay.tsx`, S6 for the room

The signature two seconds, driven by a timer chain in phases.

1. char, 0 to 2000ms. A 340% radial gradient chars inward from the screen
   edges, `char-close`, with a transparent center, a terracotta whisper and
   warm blacks. The page warms and darkens, `char-veil`. An ember rim
   breathes at the edges, `ember-rim` with inset box-shadows. Charred
   grain fades in, `char-grain`, feTurbulence noise on multiply.
2. line, at 2000ms. Lora 22px in warm parchment with a soft ember
   text-shadow: "This room has been burned.", `burn-line-in`.
3. out, at 3400ms. The whole overlay fades, `burn-out`, and at 3800ms
   `finishRoomBurn(roomId)` navigates to the desk where the ash card waits
   for exactly one session.

`role="alert"` plus `aria-live="assertive"`, because this one is allowed to
interrupt. Single-message burns are subtler: the bubble's `msg-burning`, an
ember rim dissolving upward, handled in the store's message pipeline.

---

## 7. Shared primitives

### `actions.tsx`, the verb system

One primary verb per screen. Forest means trust and action, terracotta
means destruction and impermanence only. All of them share a base: 48px
height, 12px radius, Inter 14px medium, 150ms transitions, a press-in
`active:scale-[0.99]`, and a disabled state of 50% opacity plus no pointer
events.

| Export | Look | Use |
|---|---|---|
| `PrimaryAction` | Forest fill, paper text | The screen's main verb |
| `SecondaryAction` | Side surface, hairline border | The alternate path |
| `DestructiveAction` | Terracotta fill | Burn and leave, both consequence-modaled |
| `CompactAction` | Forest, 44px | A header-placed primary |
| `QuietAction` | Text only, mute to charcoal on hover | Escapes and tertiary links |

All of them accept `busy`, a spinner plus disabled, and `full` for block
width. Forwarded refs throughout.

### `fields.tsx`, inputs

Paper surfaces, hairline borders, forest focus at a 45% border plus a 15%
ring. Errors are neutral charcoal, because only actions carry color.

- `Field`: a label, children, and a hint or error slot, where the error
  wins and gets `role="alert"`.
- `TextField`: a 48px input in Inter 15px.
- `PasswordField`: the uncontrolled secret field, Task 27. It accepts no
  `value` or `defaultValue`, typed out through `Omit`, so React never
  mirrors the typed text into the DOM `value` attribute. Elements shows no
  value for the field's whole life, and no plaintext ever sits in React
  state. Parents seed and wipe imperatively through the forwarded ref,
  where `el.value = …` sets the property only, and read once at submit.
  The eye toggle has a 44px hit area, is keyboard-focusable, and uses
  `aria-pressed`. `autoComplete="new-password"` suppresses Chrome's save
  password prompt for ephemeral room passwords. No autocapitalize and no
  spellcheck.
- `MonoValue`: a selectable mono block with an inline copy affordance and
  a "Copied" confirmation state.

### `mark.tsx`, `InkMark`, the Vanishing Ink

The brand mark: a hand-fallen ink drop seated on the page, its top fraying
into three rising flecks, the last one ember-warm. Hand-tuned beziers on a
96×96 grid, with joint radii wobbling a few percent off a compass circle
and the tail leaning a hair. The whole assembly is rotated 21° so the
flecks rise up and to the right, off the line of text, in the direction
writing leaves. The metaphors: the drop is the writing, the flecks are the
ephemerality, and the ember is the heat of the conversation leaving rather
than the paper burning. Four variants.

- `intact`, the default: the seated drop with its flecks rising. With
  `breathe`, the flecks rise and fade in low amplitude on a staggered
  loop. The `.ink-fleck-1/2/3` classes carry the stagger in globals.css,
  the hero's landing choreography stacks a second animation on the same
  flecks, and a single inline `animation-delay` would bind both. Brand,
  landing hero, desk centrepieces.
- `scattered`: the drop has lifted off. Its outline rises away while seven
  flecks flee outward and the ember flares once. It animates once on
  mount. Burn and destruction contexts only, where terracotta is
  legitimate, see the burn overlay.
- `fleck`: one four-pointed fleck alone in `currentColor`, so member inks,
  `--ink-0..7`, can drive it from outside. This is the identity system:
  every member is a fleck of the same vanishing ink, which is the bubble
  sender lines and the typing whisper's three rising flecks.
- `ghost`: the drop's outline stroked in `currentColor` with the flecks
  filled. Watermarks at whisper opacity, never intercepting a touch. With
  `draw`, the outline inks itself onto the page through a pathLength
  normalized `ghost-draw`, and the flecks surface behind its tip. Pair it
  with the `ghost-drift` class for the slow ambient float.

The hero landing choreography lives in globals.css, `.hero-mark` plus
`.drop-land` plus `.mark-land`. The drop falls with gravity easing and
squashes at impact, around 220ms. The flecks splash upward,
`fleck-splash` on the independent `translate` and `scale` properties, so
it composes with the infinite evaporation loop's `transform`. A soft ink
halo bleeds outward beneath the mark. At rest, hovering lifts the flecks
and flares the ember, again through independent properties, so the loop
never pauses.

Props stay backwards compatible, `size`, `breathe` and `className`, with
`SealMark` as an exported alias, plus `variant`, `ink` and `draw`. Pure
SVG, `aria-hidden`, and it never carries meaning on its own. Assets
regenerate from the same geometry through `scripts/gen-icons.ts` with
sharp, covering PWA icons, apple-touch and the OG image.

### `sheet-grabber.tsx`

A 36×4px rounded mute bar, `aria-hidden`. "A fold in the paper, not a
handle that promises dragging": mobile bottom sheets only.

### `theme-toggle.tsx`

The Daylight and Nightfall switch. CSS decides which icon shows,
`dark:block` and `dark:hidden`, for zero hydration guesswork. After
hydration, through a `useSyncExternalStore` check rather than an effect
setState, the icon pair is keyed by the resolved theme, so a switch
remounts the span and the new icon swings in from a quarter-turn back,
`theme-turn` at 420ms.

### `sw-register.tsx`

Registers `/sw.js` after a 1.2s idle delay with
`updateViaCache: "none"`, and failures are silent by design. The worker
itself, `public/sw.js`, is network-first for navigations,
stale-while-revalidate for static assets, now including `/legal/`,
versioned caches, and never caches `/api/` or socket traffic:
installability without retention.

Update flow, Task 22. When a freshly deployed worker takes over, either a
`controllerchange` after a first controller existed or the worker's
`cipherchat:updated` activate message, the page shows one persistent
sonner toast, "A fresh seal is ready", with a Reload action and no
auto-reload, because a half-written draft outranks freshness. Dev is
exempt, since a caching worker and HMR serve each other stale chunks.

Notification taps, Task 25. The worker's `notificationclick` handler
focuses an existing window and posts `cipherchat:navigate {roomId}`, or
`clients.openWindow("/#/r/:id")` on a cold start. This component routes
both that message and the `cc:open-room` CustomEvent from the page-level
notification fallback to `navigate("chat", roomId)`. The listeners stay
attached in dev too, where they are inert.

### `notice-stack.tsx`

The in-app notification banner, which is the fix for "a notification
enters and overlaps the top of the screen." A banner never covers
anything. It is in flow, at the top of the shell wrapper, the `Shell` in
`app.tsx`, and the whole app steps down as its grid track opens,
`notice-open`, 0fr to 1fr, 360ms. One banner per room, so a room speaking
again replaces it in place and resets its 6.5s clock, with a maximum of
three on stage. The timers live in the `store/notices.ts` zustand store,
so remounts never freeze a banner. Removal is a two-step sequence: `dismiss`
marks it leaving and the component plays `notice-close`, then `remove`
takes it off stage on animationend.

The card: the writer's ink worn as a fleck, `InkMark variant="fleck"`
inside a colored circle, the alias in the sender's ink, the room name, and
a preview line that follows the notification preference. A tap, or Enter,
goes to the room, and it is a real focusable `role="button"`. X
dismisses. The stack is `sticky top-0 z-30`, claims the safe-area padding
only while non-empty, and publishes its live height as `--cc-notice-h`
through a ResizeObserver, which `--toast-top` consumes so toasts seat
below it.

### `app-settings-sheet.tsx`

The device-level settings sheet, Task 25: Notifications, "On your home
screen" for the install, plus the About rows. `AppSettingsButton`, the
bell, is the entry point, mounted on the desk header and the landing
header. The Notifications section walks the permission states: default,
"Allow notifications" leading to `requestNotifyPermission`; granted, a
preview preference radio group of Full text, Sender only or Nothing, plus
a test notification; denied, plain copy pointing at the browser's site
settings; and unsupported, where in-app banners still work.

The Install section is platform-aware through `useInstallPrompt`: a
captured `beforeinstallprompt` gives "Install app", where our UI asks
rather than the browser's mini-infobar; iOS gives the three-tap Share
walkthrough; and standalone gives a check and silence. Since Task 31 the
About section also carries the contact, a Flag glyph plus one short
paragraph naming lilice308@gmail.com, with a button that copies the
address and an "Address copied" toast. The paragraph now says how a
room actually ends: its time runs out, or the creator burns it, and the
address reaches the project author for anything else. The finality
stays: "A room that is gone cannot be unsent, because nothing is
kept."

### `apple-splash.tsx`

A server component rendering the 13 `apple-touch-startup-image` `<link>`s,
which React 19 hoists to `<head>`, for the installed iOS launch image.
Generated by `scripts/gen-splash.ts` into `public/splash/`, 105KB total.
See MOBILE.md for the full mobile pipeline.

### `legal-sheet.tsx`

The in-app reading surface for the legal documents. A tiny local zustand
store, `useLegalSheet`, drives it. `LegalLinks` renders the footer pair,
Terms of Use and Privacy Policy, and Settings then About opens the same
store. `LegalSheetHost`, mounted once in `app.tsx` beside the overlays,
fetches `/legal/{terms,privacy}.md` on first open with a module-level
cache, and renders through react-markdown with hand-styled elements,
serif forest headings, `max-w-prose` body, hairline rules and mono code, in
the Sheet primitive, a bottom sheet at `h-[92dvh]` on mobile and a right
sheet on desktop. Centered modals stay reserved for the burn moment.
Loading is a mono status line and errors get a retry. The single source of
truth lives in `public/legal/*.md`, and the repo root has no duplicate.

---

## 8. Hooks

### `useIsDesktop`, breakpoint 768 by default

A MatchMedia listener rather than a one-shot, so sheets flip between
bottom on a phone and right on a desk live during a resize. It defaults to
false to match the mobile-first render.

### `useKeyboardInset()`, `hooks/use-keyboard-inset.ts`

Makes the on-screen keyboard visible to CSS. Mounted once in
`CipherChatApp`. The mechanics:

- It listens for `focusin` and `focusout` on any editable, meaning input,
  textarea, select and contenteditable. With no editable focused,
  `--kb-inset` stays `0px`, so desktops, headless runs and mobile URL-bar
  collapses never false-positive.
- While editing, it computes the covered height with the standard
  visual-viewport formula:
  `layoutViewportHeight (documentElement.clientHeight) − visualViewport.height − visualViewport.offsetTop`,
  clamped to 0 to 60% of layout height, updated on `visualViewport`
  resize and scroll and on window resize, rAF-batched.
- Focus hops between fields are handled by re-checking `activeElement`
  after a tick on `focusout`.
- Consumers: the bottom sheets, `bottom-[var(--kb-inset,0px)]`,
  `max-h-[calc(100dvh-var(--kb-inset,0px))]` and a 250ms transition, and
  the app shell, `pb-[var(--kb-inset,0px)]`, so the composer, the typing
  strip and the message column rise while the scroll area shrinks to the
  visible viewport.
- Division of labour: on iOS, which overlays the page, the measured inset
  is fully used. On Android it is handled natively by the
  `interactive-widget=resizes-content` viewport meta, where the inset
  reads about 0, and the two mechanisms never double-count.

---

## 9. Styling system, `globals.css`

### Tokens

Two themes on one sheet. `:root` is Daylight, with paper `#F4F1EB`, side
`#EBE7DF`, charcoal `#2C2A28`, forest `#3A4F41` and deep `#2B3D31`,
terracotta `#C85A40` and deep, ember `#E8A87C` which is motion-only, ash,
and a hairline at 8%. `.dark` is Nightfall, the `#17181A` family, with
forest `#4A6453`, a dark variant of the same desk rather than an
inversion. Eight identity inks, `--ink-0` to `--ink-7`, muted stationery
hues with no red and no neon, are selected deterministically from key
fingerprints. `--kb-inset: 0px` defaults here. The full rationale is in
DESIGN.md.

### Type classes

| Class | Face | Spec | Voice |
|---|---|---|---|
| `.t-display` | Lora 600 | 30/36 | Landing headline |
| `.t-title` | Lora 600 | 20/28 | Screen and sheet titles |
| `.t-body` | Lora 400 | 15.5/1.5 | Messages: letters, not data |
| `.t-label` | Inter 500 | 13 | Form labels |
| `.t-meta` | Inter 400 | 11px | Machine voice: time, counts, hints |
| `.t-fingerprint` | Plex Mono | grouped 4-4 | Codes and keys |

### Materials and effects

- `.bubble-self` and `.bubble-other`: forest-tinted versus side-paper
  bubbles.
- `.spent-card`: view-once spent, an ember ring at its edge.
- `.grain`: 2.8% fractal-noise paper texture, multiply, fixed overlay.
- `.scroll-quiet`: a 4px warm scrollbar, with a dark variant included.
- `.composer-blur`: backdrop blur for the composer strip.
- `.shadow-float`: the single sanctioned soft shadow. Cards stay flat and
  only floating surfaces cast.
- The iOS input-zoom guard:
  `@supports (-webkit-touch-callout: none) and (pointer: coarse) { input, textarea, select { font-size: 16px } }`,
  unlayered so it outranks Tailwind. This kills Safari's focus-zoom on the
  15 and 15.5px fields.

### Motion

Keyframes: `mark-breathe` for the idle seal, `settle` for fade-rise
entrances, `rise` for the bubble entrance, `seal-arc` and `seal-press` for
S3, `msg-burn` for a single message, `char-close`, `char-veil`,
`ember-rim`, `char-grain`, `burn-line-in` and `burn-out` for S6, and
`dot-pulse` for status dots. Durations are 150, 250, 400 and 600ms, and
the easing is `cubic-bezier(0.2, 0, 0, 1)`: weight, never bounce.
`prefers-reduced-motion` collapses everything to 150ms fades through a
mandatory override block at the end of the keyframe section.

---

## 10. shadcn/ui inventory

**Used by CipherChat**, restyled in `components/ui/`:

- `sheet.tsx`: every sheet. The bottom variant carries the keyboard
  awareness geometry from §8.
- `dialog.tsx`: exactly one consumer, the burn-consequence modal.
- `context-menu.tsx`: the message copy and burn menu, §4.
- `sonner.tsx`, the `Toaster` in layout: toasts, top-center, paper-styled.

**Available but unused**, stock scaffolding, safe to ignore or use later:
accordion, alert, alert-dialog, aspect-ratio, avatar, badge, button,
calendar, card, carousel, chart, checkbox, collapsible, command, drawer,
dropdown-menu, form, hover-card, input, input-otp, label, menubar,
navigation-menu, pagination, popover, progress, radio-group, resizable,
scroll-area, select, separator, sidebar, skeleton, slider, switch, table,
tabs, textarea, toast, toggle, toggle-group, tooltip.

That is 35 of about 48 files in `components/ui/`, and they are tracked in
the dependency audit even though nothing imports them. See
bugs/BUGS.md B40.

House rule: prefer the `cc/` primitives, `actions` and `fields`, over raw
shadcn so the verb system and the field language stay consistent.

---

## 11. Data layer

### The edge, `src/middleware.ts`

One middleware makes a nonce per request, puts it on the request and
the response as `x-nonce`, and builds the Content-Security-Policy from
it. It also sets nosniff, no-referrer, DENY framing, a permissions
policy, cross-origin isolation and HSTS in production. The static files
bypass the middleware, so `next.config.ts` sets the same static headers
and `deploy/Caddyfile` sets them at the edge.

### The schema, `prisma/`

The schema lives in `prisma/schema.prisma`, and the history lives in
`prisma/migrations/`. `0_init` is the baseline, every statement
`IF NOT EXISTS`, so it can be marked applied against a database that
the old `prisma db push` flow created. `1_join_proof` adds the join
verifier column. `deploy/entrypoint-migrate.mjs` backs the database up,
baselines a database that has tables but no migration history, and
applies what is pending. The web container waits for it.

### `store/`, the orchestrator

One Zustand store holds all client state. It is assembled from slices,
each in its own file under `store/`, and the slices take the store's
`set` and `get` as arguments: none of them imports the store, so the
dependency graph is a tree.

| File | Owns |
|---|---|
| `app.ts` | The assembly: the initial state and the five slices |
| `types.ts` | The shape of the state, the shared types, the slice type |
| `lifecycle.ts` | Boot, the hash router, the desk: `init`, `syncHash`, `navigate`, `renameRoom`, the verification marks |
| `registry.ts` | The REST registry: `createRoom`, `joinRoom`, `refreshMembers`, `adjustRoomTtl` |
| `sessions.ts` | The room's life: `enterRoom`, `leaveRoom`, `burnRoom`, `finishRoomBurn`, `panicLock`, `closeExpiredRoom`, the room settings |
| `transport.ts` | The relay socket and what arrives on it: `wireRelay`, the departure confirmation, `emitTyping` |
| `receive.ts` | The receive pipeline: a frame arrives, the cipher decides, and the result becomes a letter. The legacy envelope path too |
| `messages.ts` | The message memory and the file payload store, plus the send, spend, mark and burn actions |
| `timers.ts` | The clocks: the burn clocks, the typing whisper, the cover traffic heartbeat, the rotation check, the silent-departure grace |
| `desk.ts` | The room cards on this device and the touches on them |

| State | Shape |
|---|---|
| `ready`, `deriveIdentity` | Boot. The device seed, one random 32B, from which every room derives its own signing key. The deriver is in state; the seed never is. |
| `screen`, `activeRoomId`, `inviteCode` | Hash-router position |
| `roomCards` | The desk, persisted through `lib/local` |
| `messages` | `Record<roomId, MessageView[]>`, memory only, capped at 500 a room |
| `filePayloads` | `Record<messageId, {roomId, dataB64}>`, the file bytes, kept out of the message list under a 32MB per-room budget |
| `members`, `typing` | Live registries per room, with identity authoritative only via REST |
| `relayOnline`, `resealing` | Connection truths, where "Re-sealing" means awaiting key delivery |
| `sealing`, `burn` | Ceremony overlay triggers |

Actions, all of which UI mutations funnel through: `init`, `navigate`,
`createRoom`, `joinRoom` and `enterRoom`, the first two signing a member
proof for the registry update path and the join handling a refused
proof, including the stale-rejoin
bootstrap past the server's rotation ledger, `sendMessage(text, file?,
ttlOverride?, reply?)` which signs, pads, encrypts and relays optimistically
and carries the reply snapshot in both the frame and the optimistic view
as `replyTo`, with files becoming 1 meta plus 44 uniform chunk frames,
`emitTyping`, throttled at 2.5s over the same encrypted frames,
`spendViewOnce`, `burnMessage` with its 600ms choreography, `burnRoom` and
`finishRoomBurn`, `leaveRoom` where the remaining members re-seal under a
new random key, `renameRoom`, `setDefaultTtl`, `markVerified`, and
`refreshMembers`.

Internals worth knowing. TTL burn timers and typing-prune timers live in
module memory rather than state. Sealing enforces `MIN_SEAL_MS`. The v2
receive pipeline, `receiveFrame` to `RoomCipher.open`, enforces shape, then
registry eviction, then key version, then the ECDSA signature, then the
replay guard, and only then renders. Forged or replayed traffic becomes
either a plain rejection line, for a signature failure, or silence, for
everything else. Since round 29 both receive paths, text and
file-assembly completion, pass the verified reply through
`sanitizeReplySnapshot()` before it reaches the view. The store is a thin
adapter, and every security decision lives in `lib/room-protocol.ts` where
the Task 19 test suite can reach it.

The store was one file of about 2100 lines and owned room lifecycle,
relay wiring, rotation, timers, file transfer, notification decisions,
local persistence, burn choreography and UI state. It is five slices
now, one per concern, and the rules they share are in `store/messages.ts`
and `store/timers.ts`. See bugs/BUGS.md B29, fixed.

**The memory rules.** A room keeps at most 500 letters; the oldest go
when the cap is reached, and a letter that goes takes its file with it.
The file bytes live in their own map, keyed by the message id, under a
32MB budget per room: the oldest file is dropped when the budget is
reached, and its card says the contents are no longer here. The DOM
holds 60 letters at a time; scrolling back brings the older ones in.
See bugs/BUGS.md B28, fixed.

**Round 21 internals**, the silent-departure grace. A module-level
`silentGrace` timer map, one clock per offline member per room at 120s, is
armed by `member:presence(false)` and by the `room:state` diff, where
registry members absent from the relay's live list are marked offline,
which also fixes the stale away-dot after a refresh. When a clock expires,
only the still-connected coordinator acts, through `fireSilentEviction`,
the `stillSilentAtExpiry` gate, `POST /api/rooms/:id/evict`, and the
`member:expired` announcement. Both `member:left` and `member:expired`
funnel through `confirmDeparture()`: REST-confirmed eviction, a system
line, "left." versus "drifted away.", and coordinator rotation. `init()` is
guarded by a synchronous `initStarted` flag, because the `ready` check
alone has an await gap that once let handlers register twice. Composer
drafts live in `lib/drafts.ts`, memory-only and per-room.

### `lib/` modules

| Module | Role |
|---|---|
| `protocol.ts` | **Wire protocol v3**: frame types, uniform padding (control 20480+16B, file chunks 65536+16B, bucketed file transfers), the canonical signing string, seal and open, the replay guard (counters, session tags, a ±10min window, id dedup and persistable watermarks), the send clock, and session ECDH helpers. The canonical is `canonicalV3FromBody()`: the frame body with its own signature taken out, serialised with sorted keys, hashed, and put under a length-prefixed room id. Every field a frame carries is inside the signature, including the ttl, the view-once flag, the file metadata, the chunk bytes and the key offer contents. The v2 signing string is kept only so the test can show what it did: it joined fields with a pipe and escaped one of them, so two different bodies could produce the same string. v2 frames are refused, not verified. Files land in a size bucket, 64KB, 256KB, 1MB or 2MB, so a small file costs a small amount of traffic and the relay learns the bucket, not the file's true size. |
| `room-protocol.ts` | **`RoomCipher`**, the per-room security engine: a versioned key ring with grace, the registry eviction gate, the rotation ceremony in `rotateTo` and `rotateAsCoordinator`, join-key delivery through double-wrapped offers, the pending buffer, file-chunk assembly with sha verification, and a key-version cap. Round 29 made `sealText` and `sealFile` accept a `reply` snapshot, the file-assembly map carries it, the completed-file OpenResult hands it to the store, and `open()` verifies the raw snapshot, with sanitising only after the signature has bound the bytes. The assembler checks the chunk shape before it stores anything: the total has to be one of the size buckets' chunk counts, the seq an integer inside it, the payload at most 64,000 characters, and the meta sane. The pending transfers share a 16MB byte budget and the oldest goes when it is reached. A key version is an epoch and an offset inside it, so two members rotating at the same time land on two different versions and the higher one wins. |
| `kdf.ts` | argon2id at 64MB, t=3, p=1 in versioned key bundles, plus legacy PBKDF2 room unlock |
| `room-identity.ts` | Per-room ECDSA keys derived from the device seed through HKDF(seed, roomId), for cross-room unlinkability |
| `leave-proof.ts` | **Task 22**: `cc-leave-v1:{roomId}:{memberId}:{ts}` proof of possession, signed and verified with the room key, a ±10-min window, and it never throws |
| `member-proof.ts` | The member update proof: `cc-member-v1:{roomId}:{ecdhPub}:{ts}`, signed and verified with the room key, a ±24h window, and it never throws. The window is a day because a device with a wrong clock must not lock its owner out of a room. The ECDH key is inside the signature, so a captured proof cannot be replayed onto another key |
| `crypto.ts` | Legacy v1 primitives: PBKDF2 room keys, verifier blobs, canonical-JSON sign and verify, and base64. Still the sign and verify backbone. |
| `legacy.ts` | The PBKDF2 epoch-key cache for pre-v2 rooms, with the legacy receive path gated to them |
| `rate-limit.ts` | A token bucket at 20 frames/s per socket, an IP limiter at 5 rooms/min, and the frame-size cap. Shared by the relay and the API. The relay bucket has a second currency: 1MB/s of bytes with an 8MB burst, charged with each frame's own size. One bucket, two currencies. |
| `join-proof.ts` | The password proof: `cc-join-v1:{roomId}:{ts}:{nonce}` HMACed with the join verifier, which is an HMAC over the key derivation output bound to the room. A ten minute window, constant-time comparison, never throws, and a room without a stored verifier verifies nothing. The server keeps the verifier and never publishes it, so the password never leaves the client and the server still cannot derive the room key. |
| `creator-token.ts` | The burn token's stored form: sha256 of `cc-creator-token-v1:{token}`, compared in constant time. A legacy plain token still matches and is upgraded to the hash on first use. |
| `api-body.ts` | The one body reader for the API routes: `readJsonBody()` with a 64KB cap. It checks `content-length` first and counts the bytes as they arrive, because the header can lie. Over the cap the route answers 413. |
| `csp.ts` | The Content-Security-Policy builder: a fresh nonce per request, no `unsafe-inline` for scripts, `upgrade-insecure-requests` only in production. |
| `relay-binding.ts` | The relay's member binding: a socket claims member ids at join time and every later event speaks for the bound id. The first claim wins. |
| `silent-grace.ts` | **Round 21**: the silent-departure decision logic. `SILENT_GRACE_MS` at 120s on the client clock, `EVICT_MIN_OFFLINE_MS` at 60s on the server floor, `authorizeEviction` which is pure and which the /evict route obeys, and `stillSilentAtExpiry` which is pure and is the client's gate at timer expiry. |
| `drafts.ts` | Per-room composer drafts, memory-only like the keys |
| `identity.ts` | Deterministic aliases, "Quiet Heron", and ink indexes from fingerprints. 16-hex fingerprints (64 bits) with `3F2A · 91BC · 4D70 · C2E1` grouping. The passphrase generator, CSPRNG, a 256-word list, 6 words for 48 bits, see DESIGN.md §5. And the room-code parser. |
| `media.ts` | The image-metadata gate for the attach path: `imageNeedsScan` for scope, jpeg, png and webp, with SVG and GIF passing by policy; `imageHasMetadata`, a pure byte-level detector covering JPEG APP1-Exif, APP1-XMP and COM including FF-fill tolerance, PNG eXIf, tEXt, iTXt, zTXt and tIME, and WebP EXIF and XMP, with unparseable image bytes flagged suspect; and `reencodeImage`, a browser canvas decode to draw to encode at q0.92 for lossy formats, returning null on failure. |
| `session.ts` | **Memory-only** room sessions: member ids, kv, and the password, kept while the room is open so the invite sheet can re-share it, never on disk, and refresh meaning locked rooms by design. |
| `local.ts` | localStorage: room cards, creator tokens, verify marks, replay watermarks, the TTL-hint flag, and per-room settings |
| `relay.ts` | The single socket.io client, with its URL from `NEXT_PUBLIC_RELAY_URL`, defaulting to same-origin `/relay/`, see `.env.example` |
| `types.ts` | `MessageView`, gained `replyTo?: ReplySnapshot` in round 29; `RoomCard`; `MemberPublic` including `ecdhPub`; the legacy `WireEnvelope`; TTL steps; and `Screen`. Round 29 also added `ReplySnapshot {id, senderId, snippet, file?}`, `REPLY_SNIPPET_MAX = 120`, `makeReplySnapshot()` for the compose-time quote, which uses "Sealed message" for view-once targets, the file name plus `file: true` for files, and whitespace-collapsed 120-char text, and `sanitizeReplySnapshot()` as the post-verification UI gate with 64, 64 and 160 char caps and malformed shapes dropped, plus `isReplySnapshot()` as the shape guard. |
| `format.ts` | `fmtTime`, `fmtAgo`, `fmtTtlRemaining`, `fmtBytes` |
| `db.ts` | The Prisma client, server-side only |
| `__tests__/` | **The property suite**, with tests named after the security properties they protect: replay, rotation, padding, KDF, identity, hardening, file captions, ink reactions, silent-grace decisions, leave-proof, admission, notifications, reply round-trips, the v3 body signing, and the passphrase CSPRNG source. The per-round inventory and the current count live in `CHANGES.md`, and this row does not restate them. |

### Backend surface, for reference

REST: `POST /api/rooms` at 5/min/IP, `GET /api/rooms/:id`, `PUT verifier`
which is set-once, `POST/GET members` with a cap of 12 and carrying
`ecdhPub`, and which is **the only identity authority** keyed by pubkey,
`POST leave` for the epoch ledger bump, `POST evict` which round 21 added
for the silent-leaver write-out, consulting the relay presence snapshot
server-to-server and failing closed, at 30/min/IP, and `POST burn` on the
creatorToken.

`POST /members` and `GET /members` want the join proof when the room
has a stored verifier, which is every room sealed with the current
client. The proof is the HMAC over a timestamp and a nonce, keyed by
the join verifier, with a ten minute window. The update path, the same
route finding an existing member by pubkey, also asks for a signature
from the registered key over the room and the ECDH key being written, so
posting a pubkey back no longer replaces the ECDH key. The alias and
the ink are the server's derivation from the member's public key.
Rooms sealed before the proof existed keep the old rule. See
bugs/BUGS.md B7, B8, B9.

Every route body is capped at 64KB by the shared reader, and over the
cap the route answers 413 `body-too-large`.

Relay, socket.io on port 3003, in-memory and hardened: `room:join`,
`message:send` and `message:ack` for uniform v3 frames, `member:joined`,
`member:left`, `member:presence`, `member:expired`, `key:request`,
`room:burn`, plus the legacy `message:spent`, `member:typing` and
`message:burn` forwarding for pre-v2 clients. A per-socket token bucket at
20 frames/s sustained with a 64 burst, a second bucket at 1MB/s with an
8MB burst charged with each frame's own size, a hard frame-size cap that
disconnects, and a 16-room cap. A socket speaks only for the member ids
it claimed at join time, so it cannot announce that somebody else left
or type under another name. The relay's CORS answers only the app's
origin, from `RELAY_ALLOWED_ORIGINS`.

**Internal presence snapshot**, round 21: port 3004, `GET /presence/:roomId`,
guarded by the shared `RELAY_INTERNAL_TOKEN` header, which is the
connection authority `/evict` consults and which is not routed through the
gateway. The relay stamps `wentOfflineAt` on every silent last-socket drop,
the grace clock, and clears it on any return. The relay never touches the
database, and new joiners see no history because none exists.

---

## 12. Conventions checklist

Adding a component means obeying all of this.

1. One primary verb per surface. Forest means trust, terracotta means
   destruction and impermanence, never anything else.
2. Lora is the human voice, for messages, names and titles. Inter is the
   machine, for UI, labels and meta. Plex Mono is for codes.
3. Errors are neutral charcoal, inline, `role="alert"`, no exclamation
   marks.
4. No card shadows. Hairline borders. Radius 4, 8, 12 and 18. 44px minimum
   touch targets, with 48px primary buttons.
5. Irreversible actions require the centered consequence modal. Everything
   else uses sheets.
6. Never persist messages or keys. localStorage holds cards, tokens, marks
   and settings only.
7. Empty states are product statements, not apologies.
8. New bottom sheets get a `SheetGrabber` on mobile, the keyboard-aware
   geometry comes free from the shared `SheetContent` bottom variant, and
   the content must scroll internally with
   `overflow-y-auto overscroll-contain scroll-quiet`.
9. Respect `prefers-reduced-motion`, where entrances become 150ms fades.
10. The only security glyph is the shield that opens verification. The lock
    glyph means one thing: a locked room.
