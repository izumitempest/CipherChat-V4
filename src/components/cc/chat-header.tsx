// Chat header: room name in the human voice, member count in the
// machine's. Exactly one security glyph in the whole app — the shield
// that opens key verification.

"use client";

import { ChevronLeft, Link2, Settings2, Shield } from "lucide-react";
import { useApp } from "@/store/app";
import { cn } from "@/lib/utils";

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
  const members = useApp((s) => s.members[roomId]?.length ?? 0);
  const relayOnline = useApp((s) => s.relayOnline);
  const count = Math.max(1, members);

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
        <div className="min-w-0 flex-1 pl-1 md:pl-0">
          <p
            title={card?.localName ?? "Room"}
            className="truncate font-serif text-[16.5px] font-semibold leading-[22px] tracking-[-0.005em]"
          >
            {card?.localName ?? "Room"}
          </p>
          <p className="t-meta mt-0.5 flex items-center gap-1.5 truncate">
            <span>
              {count} {count === 1 ? "member" : "members"}
            </span>
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
