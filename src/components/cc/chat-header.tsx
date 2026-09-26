// Chat header: room name in the human voice, member count in the
// machine's. Exactly one security glyph in the whole app: the shield
// that opens key verification.

"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, Link2, Settings2, Shield } from "lucide-react";
import { InkMark } from "@/components/cc/mark";
import { useApp } from "@/store/app";
import { getSession } from "@/lib/session";
import { fmtTtlRemaining } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MemberPublic } from "@/lib/types";

const EMPTY_MEMBERS: MemberPublic[] = [];

export function ChatHeader({
  roomId,
  onInvite,
  onVerify,
  onSettings,
}: {
  roomId: string;
  onInvite: () => void;
  onVerify: () => void;
  onSettings: () => void;
}) {
  const navigate = useApp((s) => s.navigate);
  const card = useApp((s) => s.roomCards.find((c) => c.roomId === roomId));
  const members = useApp((s) => s.members[roomId] ?? EMPTY_MEMBERS);
  const relayOnline = useApp((s) => s.relayOnline);
  const resealing = useApp((s) => !!s.resealing[roomId]);
  const count = Math.max(1, members.length);

  /* The re-seal, announced without words: when the room's keys finish
   * rotating (resealing[roomId] falling back to false), an intact
   * drop stamps once beside the name and rests into nothing. Render-
   * time state adjustment (the sanctioned no-effect pattern); the mark
   * unmounts itself on animation end, so no timer exists to leak. */
  const [resealFlash, setResealFlash] = useState(0);
  const [wasResealing, setWasResealing] = useState(resealing);
  if (resealing !== wasResealing) {
    setWasResealing(resealing);
    if (wasResealing) setResealFlash(Date.now());
  }

  /* The room's clock, ticking in the machine's voice. Only mounted
   * when a clock exists; a minute out, it warms to terracotta. */
  const expiresAt = getSession(roomId)?.expiresAt ?? card?.expiresAt;
  const [clock, setClock] = useState(() =>
    expiresAt ? fmtTtlRemaining(expiresAt - Date.now()) : null,
  );
  const [prevExpires, setPrevExpires] = useState(expiresAt);
  if (prevExpires !== expiresAt) {
    setPrevExpires(expiresAt);
    setClock(expiresAt ? fmtTtlRemaining(expiresAt - Date.now()) : null);
  }
  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(
      () => setClock(fmtTtlRemaining(expiresAt - Date.now())),
      1000,
    );
    return () => clearInterval(t);
  }, [expiresAt]);
  const closingSoon = !!expiresAt && expiresAt - Date.now() < 60_000;

  return (
    <header className="sticky top-0 z-20 border-b border-hairline bg-paper pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex h-14 w-full max-w-[720px] items-center gap-1 px-2 sm:px-4">
        <button
          type="button"
          aria-label="Back to rooms"
          onClick={() => navigate("rooms")}
          className="flex size-11 shrink-0 items-center justify-center rounded-[12px] text-mute transition duration-150 hover:bg-wash hover:text-charcoal active:bg-wash active:scale-[0.96] md:hidden"
        >
          <ChevronLeft className="size-5" />
        </button>
        <div className="relative min-w-0 flex-1 pl-1 md:pl-0">
          {/* The re-stamp: absolutely placed so the header never
              reflows. The drop appears, stamps, and is gone. */}
          {resealFlash ? (
            <span
              key={resealFlash}
              aria-hidden
              onAnimationEnd={() => setResealFlash(0)}
              className="reseal-flash pointer-events-none absolute right-1 top-1/2 -translate-y-1/2"
            >
              <InkMark size={16} />
            </span>
          ) : null}
          <p
            title={card?.localName ?? "Room"}
            className="truncate font-serif text-[16.5px] font-semibold leading-[22px] tracking-[-0.005em]"
          >
            {card?.localName ?? "Room"}
          </p>
          <p className="t-meta mt-0.5 flex items-center gap-1.5 truncate">
            {/* Presence, as ink: each member a dot in their own ink;
                away ones rest at 35%. Decoration only: the count below
                is the accessible text. */}
            <span
              aria-hidden
              className="inline-flex shrink-0 items-center gap-1"
            >
              {members.slice(0, 5).map((m) => (
                <span
                  key={m.memberId}
                  className="dot-in size-1.5 rounded-full transition-opacity duration-[250ms]"
                  style={{
                    background: `var(--ink-${m.colorIdx})`,
                    opacity: m.connected === false ? 0.35 : 1,
                  }}
                />
              ))}
            </span>
            <span className="truncate">
              {count} {count === 1 ? "member" : "members"}
            </span>
            {clock ? (
              <>
                <span aria-hidden>·</span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 tabular-nums",
                    closingSoon && "text-terracotta/80",
                  )}
                >
                  closes {clock}
                  <span className="sr-only"> from now</span>
                </span>
              </>
            ) : null}
            {!relayOnline ? (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="dot-pulse size-1.5 rounded-full bg-mute"
                    aria-hidden
                  />
                  offline
                </span>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 items-center">
          <HeaderIcon label="Share invite" onClick={onInvite}>
            <Link2 className="size-[18px]" />
          </HeaderIcon>
          <HeaderIcon label="Verify participants" onClick={onVerify}>
            <Shield className="size-[18px]" />
          </HeaderIcon>
          <HeaderIcon label="Room settings" onClick={onSettings}>
            <Settings2 className="size-[18px]" />
          </HeaderIcon>
        </div>
      </div>
    </header>
  );
}

function HeaderIcon({
  label,
  onClick,
  children,
  className,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "flex size-11 items-center justify-center rounded-[12px] text-mute transition duration-150 hover:bg-wash hover:text-charcoal active:bg-wash active:scale-[0.96]",
        className,
      )}
    >
      {children}
    </button>
  );
}
