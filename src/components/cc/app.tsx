// The shell. One route, hash-driven: #/ (landing), #/join (invite),
// #/rooms (the desk), #/r/:id (a room). Desktop keeps the desk in a
// sidebar, iMessage-style; mobile is a single column. This is a PWA.

"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { InkMark } from "@/components/cc/mark";
import { SealingOverlay } from "@/components/cc/sealing";
import { BurnOverlay } from "@/components/cc/burn-overlay";
import { LegalSheetHost } from "@/components/cc/legal-sheet";
import { NoticeStack } from "@/components/cc/notice-stack";
import { LandingScreen } from "@/components/screens/landing";
import { InviteScreen } from "@/components/screens/invite";
import { RoomListColumn } from "@/components/screens/room-list";
import { ChatScreen } from "@/components/screens/chat";
import { parseRoomCode } from "@/lib/identity";
import { syncBadge } from "@/lib/notifications";
import { useApp } from "@/store/app";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { cn } from "@/lib/utils";

export default function CipherChatApp() {
  const init = useApp((s) => s.init);
  const ready = useApp((s) => s.ready);

  // Publish the keyboard's covered height as --kb-inset for the
  // shell and every bottom sheet (iOS Safari overlays the page
  // instead of resizing it).
  useKeyboardInset();

  useEffect(() => {
    void init();
  }, [init]);

  // ?join=CODE - an invite link's first landing.
  const searchParams = useSearchParams();
  useEffect(() => {
    if (!ready) return;
    const join = searchParams.get("join");
    if (join) {
      const code = parseRoomCode(join);
      if (code) {
        history.replaceState(null, "", `/#/join/${code}`);
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      }
    }
  }, [ready, searchParams]);

  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        {/* The mark breathes while the desk is unlocked. The app
            is alive from the first frame. */}
        <InkMark size={44} breathe className="opacity-60" />
      </div>
    );
  }

  return (
    <>
      <Shell />
      <SealingOverlay />
      <BurnOverlay />
      <LegalSheetHost />
    </>
  );
}

/* The desk and the room need an exact viewport fit (their own inner
 * scroll); landing and invite are pages that grow. The wrapper picks
 * its height accordingly, and the notice stack rides above both,
 * in flow, so a banner never covers anything: the app steps down. */
function Shell() {
  const screen = useApp((s) => s.screen);
  const scrolls = screen === "landing" || screen === "invite";
  return (
    <div
      className={cn(
        "flex flex-col bg-paper",
        scrolls ? "min-h-dvh" : "h-dvh overflow-hidden",
      )}
    >
      <NoticeStack />
      <div className="flex min-h-0 flex-1 flex-col">
        <Screens />
      </div>
      <BadgeSync />
    </div>
  );
}

/* The launcher badge: the sum of unread letters, kept in step with
 * the desk. Cleared the moment the rooms are read (or swept). */
function BadgeSync() {
  const roomCards = useApp((s) => s.roomCards);
  useEffect(() => {
    const total = roomCards.reduce(
      (sum, c) => sum + (c.unread ? Math.min(c.unreadCount ?? 1, 99) : 0),
      0,
    );
    syncBadge(total);
  }, [roomCards]);
  return null;
}

function Screens() {
  const screen = useApp((s) => s.screen);
  const activeRoomId = useApp((s) => s.activeRoomId);

  if (screen === "landing") {
    return <LandingScreen />;
  }
  if (screen === "invite") {
    return <InviteScreen />;
  }

  // The desk and the room share a layout: sidebar on desktop,
  // single column on mobile. Padding-bottom = the keyboard's covered
  // height (iOS): the composer and message column rise above it and
  // the scroll area shrinks to the visible viewport.
  const inRoom = screen === "chat" && activeRoomId;
  return (
    <div className="screen-in flex h-full overflow-hidden bg-paper pb-[var(--kb-inset,0px)] transition-[padding-bottom] duration-[250ms]">
      <div
        className={cn(
          "h-full w-full shrink-0 md:w-[320px] md:border-r md:border-hairline",
          inRoom ? "hidden md:block" : "block",
        )}
      >
        <RoomListColumn />
      </div>
      <main className="min-w-0 flex-1">
        {inRoom ? (
          /* Keyed by room: switching letters is switching pages.
             The room takes its seat with the same entrance every
             screen gets, and its scroll state starts fresh. */
          <ChatScreen key={activeRoomId} roomId={activeRoomId} />
        ) : (
          <div className="screen-in hidden h-full flex-col items-center justify-center px-8 md:flex">
            <InkMark size={44} breathe className="opacity-50" />
            <p className="mt-6 max-w-[260px] text-center font-serif text-[16px] leading-[24px] text-mute">
              Open a letter, or start a new one.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
