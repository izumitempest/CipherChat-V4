// S5 — The room. S8 — the empty room, which is the product speaking,
// not an apology. And the locked state, which is a first-class moment:
// never an error, never a dead end.

"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Lock } from "lucide-react";
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
import { useApp } from "@/store/app";
import type { MessageView, MemberPublic } from "@/lib/types";

const EMPTY_MESSAGES: MessageView[] = [];
const EMPTY_MEMBERS: MemberPublic[] = [];

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

  const scrollRef = useRef<HTMLDivElement>(null);
  const groups = useMessageGroups(messages);

  // Fresh scroll to the newest line as messages arrive.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 220;
    if (nearBottom || messages[messages.length - 1]?.self) {
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

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-quiet"
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
            groups.map(({ message, position }) =>
              message.kind === "system" ? (
                <SystemLine key={message.id} text={message.text ?? ""} />
              ) : (
                <MessageBubble
                  key={message.id}
                  message={message}
                  position={position}
                  onOpenFile={(m) => setViewing(m)}
                />
              ),
            )
          )}
        </div>
      </div>

      <Composer key={roomId} />

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
