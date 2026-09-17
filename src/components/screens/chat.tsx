// S5 — The room. S8 — the empty room, which is the product speaking,
// not an apology. And the locked state, which is a first-class moment:
// never an error, never a dead end.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Copy, Hourglass, Lock, X } from "lucide-react";
import { toast } from "sonner";
import { ChatHeader } from "@/components/cc/chat-header";
import { Composer } from "@/components/cc/composer";
import { MessageBubble, SystemLine, useMessageGroups } from "@/components/cc/bubble";
import { InviteSheet } from "@/components/cc/invite-sheet";
import { VerificationSheet } from "@/components/cc/verification-sheet";
import { SettingsSheet } from "@/components/cc/settings-sheet";
import { FileViewer } from "@/components/cc/file-viewer";
import { Field, PasswordField } from "@/components/cc/fields";
import { PrimaryAction, QuietAction } from "@/components/cc/actions";
import { SealMark } from "@/components/cc/mark";
import { getSession } from "@/lib/session";
import { markTtlHintSeen, ttlHintSeen } from "@/lib/local";
import { useApp, type TypingSignal } from "@/store/app";
import { fmtTime } from "@/lib/format";
import type { MessageView, MemberPublic } from "@/lib/types";

const EMPTY_MESSAGES: MessageView[] = [];
const EMPTY_MEMBERS: MemberPublic[] = [];
const EMPTY_TYPING: TypingSignal[] = [];

/** Messages quiet down across a gap wider than this. */
const TIME_GAP_MS = 30 * 60 * 1000;

export function ChatScreen({ roomId }: { roomId: string }) {
  // Subscribe to the room's message memory: entering a room resets it,
  // which re-renders this check with a live session in place.
  useApp((s) => s.messages[roomId]);
  const session = getSession(roomId);

  if (!session) {
    return <LockedRoomView roomId={roomId} />;
  }
  return <ActiveRoom roomId={roomId} />;
}

/* ------------------------------------------------ S5 / S8 ---- */

function ActiveRoom({ roomId }: { roomId: string }) {
  const messages = useApp((s) => s.messages[roomId] ?? EMPTY_MESSAGES);
  const members = useApp((s) => s.members[roomId] ?? EMPTY_MEMBERS);
  const navigate = useApp((s) => s.navigate);
  const spendViewOnce = useApp((s) => s.spendViewOnce);
  const burnMessage = useApp((s) => s.burnMessage);
  const session = getSession(roomId);
  const isCreator = !!session?.creatorToken;

  const [inviteOpen, setInviteOpen] = useState(() => {
    // After creating a room, the natural next verb is the invite.
    const key = `cc.inviteShown.${roomId}`;
    return isCreator && !sessionStorage.getItem(key);
  });
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [viewing, setViewing] = useState<MessageView | null>(null);
  // The timer explained once — the flag lives on this device.
  const [hintRoom, setHintRoom] = useState<string | null>(() =>
    !ttlHintSeen() && (getSession(roomId)?.defaultTtl ?? 0) > 0
      ? roomId
      : null,
  );
  // Adjusting state when the room prop changes — the sanctioned way,
  // no effect needed. A room that already expires its letters
  // explains itself once, quietly.
  const [hintRoomChecked, setHintRoomChecked] = useState(roomId);
  if (roomId !== hintRoomChecked) {
    setHintRoomChecked(roomId);
    setHintRoom(
      !ttlHintSeen() && (getSession(roomId)?.defaultTtl ?? 0) > 0
        ? roomId
        : null,
    );
  }
  const ttlHint = hintRoom === roomId;

  const scrollRef = useRef<HTMLDivElement>(null);
  const groups = useMessageGroups(messages);

  /* The jump affordance — present only when the newest line is out
   * of sight. Counts what arrived below the fold while reading. */
  const [showJump, setShowJump] = useState(false);
  const [newBelow, setNewBelow] = useState(0);
  const nearBottomRef = useRef(true);
  const prevCountRef = useRef(messages.length);

  const readScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 220;
    nearBottomRef.current = near;
    setShowJump(!near && el.scrollHeight > el.clientHeight + 80);
    if (near) setNewBelow(0);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", readScroll, { passive: true });
    return () => el.removeEventListener("scroll", readScroll);
  }, [readScroll]);

  const jumpToLatest = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduced ? "auto" : "smooth" });
    setNewBelow(0);
  }, []);

  // Fresh scroll to the newest line as messages arrive.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const grew = messages.length - prevCountRef.current;
    prevCountRef.current = messages.length;
    const last = messages[messages.length - 1];
    // Something arrived below the fold while reading — count it,
    // stay put, and let the pill carry the news.
    if (grew > 0 && !nearBottomRef.current && last && !last.self && last.kind !== "system") {
      setNewBelow((n) => n + grew);
      return;
    }
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 220;
    if (nearBottom || last?.self) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  // Mark the invite as shown (an external-system update — the
  // auto-open itself is decided by the initial state above).
  useEffect(() => {
    if (inviteOpen && isCreator) {
      sessionStorage.setItem(`cc.inviteShown.${roomId}`, "1");
    }
  }, [inviteOpen, isCreator, roomId]);

  // Escape from a quiet composer returns to the desk. Sheets, menus,
  // dialogs and the file viewer own the key first (they prevent it);
  // a composer holding words never loses them to a stray Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[data-state="open"], [role="dialog"]')) return;
      const composer = document.querySelector(
        'textarea[aria-label="Message"]',
      ) as HTMLTextAreaElement | null;
      if (composer && composer.value.trim().length > 0) return;
      navigate("rooms");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  const dismissTtlHint = useCallback(() => {
    setHintRoom(null);
    markTtlHintSeen();
  }, []);

  // A room that already expires its letters explains itself once.
  // (Handled during render above — the state adjusts when the room
  // prop changes, which is the sanctioned no-effect pattern.)

  // The hint never lingers — it states its fact and leaves.
  useEffect(() => {
    if (!ttlHint) return;
    const t = setTimeout(dismissTtlHint, 10_000);
    return () => clearTimeout(t);
  }, [ttlHint, dismissTtlHint]);
  const solo = members.filter((m) => m.connected !== false).length <= 1;
  const empty = messages.length === 0;

  async function copyInviteLink() {
    const link = `${window.location.origin}/?join=${roomId}`;
    try {
      await navigator.clipboard.writeText(link);
      toast("Invite link copied", {
        description: "Send the password through a different channel.",
      });
    } catch {
      setInviteOpen(true);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      <ChatHeader
        roomId={roomId}
        onInvite={() => setInviteOpen(true)}
        onVerify={() => setVerifyOpen(true)}
        onSettings={() => setSettingsOpen(true)}
      />

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          className="h-full overflow-y-auto overscroll-contain scroll-quiet"
          role="log"
          aria-live="polite"
          aria-label="Messages"
        >
          <div className="mx-auto w-full max-w-[720px] px-4 pb-5 pt-4">
            {empty ? (
              solo && isCreator ? (
                /* The creator's empty room: the verb is the invite. */
                <div className="settle flex flex-col items-center px-6 pb-16 pt-[16vh] text-center">
                  <SealMark size={40} className="opacity-70" />
                  <p className="t-body mt-6 max-w-[300px]">
                    Invite someone to begin.
                  </p>
                  <p className="mt-1.5 max-w-[320px] font-sans text-[13px] leading-[19px] text-mute">
                    Share the link — and send the password through a different
                    channel.
                  </p>
                  <PrimaryAction className="mt-7" onClick={copyInviteLink}>
                    <Copy className="size-4" aria-hidden />
                    Copy invite link
                  </PrimaryAction>
                  <QuietAction className="mt-2" onClick={() => setInviteOpen(true)}>
                    Show the password
                  </QuietAction>
                </div>
              ) : (
                /* S8 — the joiner's empty room: the product statement. */
                <div className="settle flex flex-col items-center px-6 pb-16 pt-[16vh] text-center">
                  <SealMark size={40} className="opacity-70" />
                  <p className="t-body mt-6 max-w-[340px]">
                    You won&rsquo;t see messages from before you joined.
                    That&rsquo;s how this works.
                  </p>
                  <p className="mt-1.5 max-w-[320px] font-sans text-[13px] leading-[19px] text-mute">
                    Everything from this moment on is encrypted and, if set to
                    expire, will destroy itself.
                  </p>
                </div>
              )
            ) : (
              <TimeAwareMessages
                groups={groups}
                onOpenFile={(m) => setViewing(m)}
                onBurnMessage={(m) => void burnMessage(roomId, m.id)}
              />
            )}
          </div>
        </div>

        {showJump ? (
          <button
            type="button"
            onClick={jumpToLatest}
            aria-label={
              newBelow > 0
                ? `Scroll to ${newBelow} new ${newBelow === 1 ? "message" : "messages"}`
                : "Scroll to the latest messages"
            }
            className="settle absolute bottom-3 left-1/2 flex h-11 -translate-x-1/2 items-center gap-1.5 rounded-full border border-hairline bg-side px-4 font-sans text-[12.5px] font-medium text-charcoal shadow-float transition duration-150 hover:-translate-y-px hover:border-forest/30 hover:bg-wash active:translate-y-0 active:scale-[0.97]"
          >
            {newBelow > 0 ? (
              <>
                <span className="size-1.5 rounded-full bg-forest" aria-hidden />
                {newBelow} new {newBelow === 1 ? "message" : "messages"}
              </>
            ) : (
              <>
                <ChevronDown className="size-4 text-forest" aria-hidden />
                Latest
              </>
            )}
          </button>
        ) : null}
      </div>

      {/* Reserved strip — someone is writing, quietly. The space is
          always there so nothing jumps when a whisper begins. */}
      <TypingLine roomId={roomId} />

      {ttlHint ? (
        <div className="settle mx-auto flex w-full max-w-[720px] items-center gap-2 px-5 pb-1.5 pt-2">
          <Hourglass className="size-3.5 shrink-0 text-terracotta" aria-hidden />
          <p className="t-meta min-w-0 flex-1">
            Messages set to expire burn themselves when the clock runs out —
            for everyone.
          </p>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={dismissTtlHint}
            className="relative flex size-8 shrink-0 items-center justify-center rounded-[8px] text-mute transition-colors duration-150 hover:bg-wash hover:text-charcoal before:absolute before:-inset-1.5 before:content-['']"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}

      <Composer key={roomId} onTtlArmed={() => setHintRoom(roomId)} />

      <InviteSheet roomId={roomId} open={inviteOpen} onOpenChange={setInviteOpen} />
      <VerificationSheet roomId={roomId} open={verifyOpen} onOpenChange={setVerifyOpen} />
      <SettingsSheet roomId={roomId} open={settingsOpen} onOpenChange={setSettingsOpen} />
      <FileViewer
        message={viewing}
        onClose={() => setViewing(null)}
        onSpent={(m) => m.viewOnce && spendViewOnce(roomId, m.id)}
      />
    </div>
  );
}

/* ------------------------------------------ message flow ---- */

/** Messages between long silences get a quiet timestamp divider —
 *  the machine noting the passage of time, nothing more. */
function TimeAwareMessages({
  groups,
  onOpenFile,
  onBurnMessage,
}: {
  groups: ReturnType<typeof useMessageGroups>;
  onOpenFile: (m: MessageView) => void;
  onBurnMessage: (m: MessageView) => void;
}) {
  const rendered: React.ReactNode[] = [];
  let lastTs: number | null = null;
  for (const { message, position } of groups) {
    if (message.kind !== "system") {
      if (lastTs !== null && message.ts - lastTs > TIME_GAP_MS) {
        rendered.push(<TimeDivider key={`d-${message.id}`} ts={message.ts} />);
      }
      lastTs = message.ts;
    }
    rendered.push(
      message.kind === "system" ? (
        <SystemLine key={message.id} text={message.text ?? ""} />
      ) : (
        <MessageBubble
          key={message.id}
          message={message}
          position={position}
          onOpenFile={onOpenFile}
          onBurn={() => onBurnMessage(message)}
        />
      ),
    );
  }
  return <>{rendered}</>;
}

function TimeDivider({ ts }: { ts: number }) {
  const d = new Date(ts);
  const sameDay = d.toDateString() === new Date().toDateString();
  const label = sameDay
    ? fmtTime(ts)
    : `${d.toLocaleDateString([], { weekday: "short" })} · ${fmtTime(ts)}`;
  return (
    <p className="t-meta py-2.5 text-center" role="separator">
      {label}
    </p>
  );
}

/* --------------------------------------------- the whisper ---- */

function TypingLine({ roomId }: { roomId: string }) {
  const typing = useApp((s) => s.typing[roomId] ?? EMPTY_TYPING);
  const members = useApp((s) => s.members[roomId] ?? EMPTY_MEMBERS);

  const named = typing.map((t) => ({
    alias: t.alias,
    colorIdx: members.find((m) => m.memberId === t.memberId)?.colorIdx ?? 0,
  }));

  let content: React.ReactNode = null;
  if (named.length === 1) {
    content = (
      <>
        <TypingAlias {...named[0]} /> is writing…
      </>
    );
  } else if (named.length === 2) {
    content = (
      <>
        <TypingAlias {...named[0]} /> and <TypingAlias {...named[1]} /> are
        writing…
      </>
    );
  } else if (named.length > 2) {
    content = <>Several people are writing…</>;
  }

  return (
    <div className="mx-auto flex h-[26px] w-full max-w-[720px] items-center justify-center px-5">
      {content ? (
        <p className="t-meta settle" aria-live="polite">
          {/* Three ink dots, kept nearly still — decoration only;
             the sentence below stays the aria-live text. */}
          <span
            className="mr-1.5 inline-flex items-center gap-[3px]"
            aria-hidden
          >
            <span className="typing-dot size-1 rounded-full bg-mute" />
            <span
              className="typing-dot size-1 rounded-full bg-mute"
              style={{ animationDelay: "180ms" }}
            />
            <span
              className="typing-dot size-1 rounded-full bg-mute"
              style={{ animationDelay: "360ms" }}
            />
          </span>
          {content}
        </p>
      ) : null}
    </div>
  );
}

function TypingAlias({ alias, colorIdx }: { alias: string; colorIdx: number }) {
  return (
    <span className="font-medium" style={{ color: `var(--ink-${colorIdx})` }}>
      {alias}
    </span>
  );
}

/* --------------------------------------------- locked room ---- */

function LockedRoomView({ roomId }: { roomId: string }) {
  const card = useApp((s) => s.roomCards.find((c) => c.roomId === roomId));
  const joinRoom = useApp((s) => s.joinRoom);
  const navigate = useApp((s) => s.navigate);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !password.trim()) return;
    setBusy(true);
    setError(null);
    const res = await joinRoom(roomId, password.trim());
    setBusy(false);
    if (!res.ok) {
      setError(
        res.reason === "wrong-password"
          ? "That password doesn't match this room."
          : res.reason === "not-found" || res.reason === "burned"
            ? "This room doesn't exist, or it has been burned."
            : "Something went wrong. Try again.",
      );
      return;
    }
  }

  return (
    <div className="flex h-full flex-col bg-paper">
      <ChatHeader
        roomId={roomId}
        onInvite={() => toast("Unlock the room first")}
        onVerify={() => toast("Unlock the room first")}
        onSettings={() => toast("Unlock the room first")}
      />
      <main className="flex flex-1 flex-col items-center justify-center px-6">
        <form
          onSubmit={submit}
          className="settle w-full max-w-[340px] rounded-[18px] border border-hairline bg-side p-6"
        >
          <span className="flex size-11 items-center justify-center rounded-[12px] border border-hairline bg-paper text-mute">
            <Lock className="size-5" aria-hidden />
          </span>
          <p className="t-title mt-4">{card?.localName ?? "Room"}</p>
          <p className="mt-1.5 font-sans text-[13px] leading-[19px] text-mute">
            This room is locked. Keys live only in memory — re-enter the
            password to return.
          </p>
          <div className="mt-5 space-y-4">
            <Field label="Room password" htmlFor="cc-locked-pass" error={error}>
              <PasswordField
                id="cc-locked-pass"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="room password"
                autoFocus
              />
            </Field>
            <PrimaryAction type="submit" full busy={busy}>
              {busy ? "Unlocking" : "Unlock"}
            </PrimaryAction>
            <QuietAction className="w-full" onClick={() => navigate("rooms")}>
              Back to your rooms
            </QuietAction>
          </div>
        </form>
      </main>
    </div>
  );
}
