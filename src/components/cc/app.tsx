// The shell. One route, hash-driven: #/ (landing), #/join (invite),
// #/rooms (the desk), #/r/:id (a room). Desktop keeps the desk in a
// sidebar, iMessage-style; mobile is a single column. This is a PWA.

"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { SealMark } from "@/components/cc/mark";
import { SealingOverlay } from "@/components/cc/sealing";
import { BurnOverlay } from "@/components/cc/burn-overlay";
import { LandingScreen } from "@/components/screens/landing";
import { InviteScreen } from "@/components/screens/invite";
import { RoomListColumn } from "@/components/screens/room-list";
import { ChatScreen } from "@/components/screens/chat";
import { parseRoomCode } from "@/lib/identity";
import { useApp } from "@/store/app";
import { cn } from "@/lib/utils";

export default function CipherChatApp() {
  const init = useApp((s) => s.init);
  const ready = useApp((s) => s.ready);

  useEffect(() => {
    void init();
  }, [init]);

  // ?join=CODE — an invite link's first landing.
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
        <SealMark size={44} className="opacity-60" />
      </div>
    );
  }

  return (
    <>
      <Screens />
      <SealingOverlay />
      <BurnOverlay />
    </>
  );
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
  // single column on mobile.
  const inRoom = screen === "chat" && activeRoomId;
  return (
    <div className="flex h-dvh overflow-hidden bg-paper">
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
          <ChatScreen roomId={activeRoomId} />
        ) : (
          <div className="hidden h-full flex-col items-center justify-center px-8 md:flex">
            <SealMark size={44} className="opacity-50" />
            <p className="mt-6 max-w-[260px] text-center font-serif text-[16px] leading-[24px] text-mute">
              Open a letter, or start a new one.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
