// S4 — The desk. A stack of open letters: local name, who's there,
// quiet unread dot, last touch. Locked rooms ask for their password
// again — that's the product, not an error.
//
// One instance serves both breakpoints: the full screen on mobile,
// the sidebar on desktop.

"use client";

import { useState } from "react";
import { Lock, Mail, Plus } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Field, PasswordField } from "@/components/cc/fields";
import { PrimaryAction, SecondaryAction } from "@/components/cc/actions";
import { SealMark } from "@/components/cc/mark";
import { ThemeToggle } from "@/components/cc/theme-toggle";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { fmtAgo } from "@/lib/format";
import { getSession } from "@/lib/session";
import { useApp } from "@/store/app";
import type { RoomCard } from "@/lib/types";
import { cn } from "@/lib/utils";

export function RoomListColumn() {
  const navigate = useApp((s) => s.navigate);
  return (
    <div className="flex h-full flex-col bg-paper md:bg-transparent">
      <header className="flex items-center justify-between gap-2 px-4 pb-2 pt-[max(1rem,env(safe-area-inset-top))] sm:px-5">
        <h1 className="t-title">Your rooms</h1>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="New room"
            title="New room"
            onClick={() => navigate("landing")}
            className="flex size-11 items-center justify-center rounded-[12px] border border-hairline bg-side text-mute transition duration-150 hover:border-forest/25 hover:bg-wash hover:text-charcoal active:translate-y-px"
          >
            <Plus className="size-[18px]" />
          </button>
          <ThemeToggle />
        </div>
      </header>
      <RoomListBody />
      <div className="pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 text-center">
        <button
          onClick={() => navigate("invite")}
          className="inline-flex h-11 items-center font-sans text-[12.5px] font-medium text-mute underline decoration-mute/45 underline-offset-4 transition-colors duration-150 hover:text-charcoal hover:decoration-current"
        >
          Have an invite link? Join a room
        </button>
      </div>
    </div>
  );
}

function RoomListBody() {
  const roomCards = useApp((s) => s.roomCards);
  const navigate = useApp((s) => s.navigate);
  const [unlocking, setUnlocking] = useState<RoomCard | null>(null);

  const body = roomCards.length === 0 ? (
    <div className="settle flex flex-1 flex-col items-center justify-center px-6 py-12">
      <SealMark size={44} className="opacity-70" />
      <p className="t-body mt-6 text-center">No rooms yet.</p>
      <p className="mt-1 text-center font-sans text-[13px] leading-[19px] text-mute">
        Create one, or open an invite link.
      </p>
      <div className="mt-7 flex w-full max-w-[280px] flex-col gap-3">
        <PrimaryAction full onClick={() => navigate("landing")}>
          Create a room
        </PrimaryAction>
        <SecondaryAction full onClick={() => navigate("invite")}>
          Join with a link or code
        </SecondaryAction>
      </div>
    </div>
  ) : (
    <ul className="flex flex-1 flex-col gap-3 overflow-y-auto overscroll-contain scroll-quiet px-4 pb-4 sm:px-5 md:gap-2 md:pb-3">
      {roomCards.map((card) => (
        <RoomCardRow
          key={card.roomId}
          card={card}
          locked={!getSession(card.roomId)}
          onOpen={() => {
            if (card.burned) return;
            if (getSession(card.roomId)) {
              navigate("chat", card.roomId);
            } else {
              setUnlocking(card);
            }
          }}
        />
      ))}
    </ul>
  );

  return (
    <>
      {roomCards.length > 0 && roomCards.some((c) => !getSession(c.roomId)) ? (
        <p className="px-4 pb-2 pt-1 text-center font-sans text-[11.5px] leading-[16px] text-mute sm:px-5">
          Rooms lock when you refresh — re-enter each password to return.
        </p>
      ) : null}
      {body}
      <UnlockSheet card={unlocking} onOpenChange={(v) => !v && setUnlocking(null)} />
    </>
  );
}

function RoomCardRow({
  card,
  locked,
  onOpen,
}: {
  card: RoomCard;
  locked: boolean;
  onOpen: () => void;
}) {
  const members = useApp((s) => s.members[card.roomId]?.length ?? 0);
  const isOpen = useApp((s) => s.activeRoomId === card.roomId);
  const count = Math.max(1, members || card.lastMembers || 1);

  if (card.burned) {
    // The one-session ash state: quiet, gray, gone after reload.
    return (
      <li>
        <div
          aria-disabled
          className="flex items-center justify-between gap-3 rounded-[12px] border border-dashed border-ash/45 bg-paper px-4 py-3"
        >
          <div className="min-w-0">
            <p className="t-body relative truncate text-ash">
              {card.localName}
              <span
                aria-hidden
                className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 -rotate-2 bg-ash/50"
              />
            </p>
            <p className="t-meta mt-0.5 text-ash/70">Burned — this room is gone</p>
          </div>
          <Mail className="size-4 shrink-0 text-ash/50" aria-hidden />
        </div>
      </li>
    );
  }

  return (
    <li>
      <button
        onClick={onOpen}
        className={cn(
          "group flex w-full items-center gap-3 rounded-[12px] border border-hairline bg-side px-4 py-3 text-left transition duration-150 hover:-translate-y-px hover:border-forest/25 hover:bg-wash active:translate-y-0",
          locked && "bg-paper hover:translate-y-0 hover:border-forest/15 hover:bg-wash/50",
          isOpen && !locked && "border-forest/30 bg-wash",
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className={cn("t-body truncate", locked && "text-mute")}>
              {card.localName}
            </p>
            {card.unread && !locked ? (
              <span
                className="size-2 shrink-0 translate-y-px rounded-full bg-forest"
                aria-label="New messages"
              />
            ) : null}
          </div>
          <p
            className={cn(
              "t-meta mt-1 flex items-center gap-1.5",
              locked && "text-mute/75",
            )}
          >
            {locked ? (
              <Lock className="size-3 text-mute/60" aria-label="Locked room" />
            ) : null}
            <span>
              {count} {count === 1 ? "member" : "members"}
            </span>
            <span aria-hidden>·</span>
            <span>{fmtAgo(card.lastActivity)}</span>
          </p>
        </div>
      </button>
    </li>
  );
}

/* -------------------------------------------------------------- */

export function UnlockSheet({
  card,
  onOpenChange,
}: {
  card: RoomCard | null;
  onOpenChange: (open: boolean) => void;
}) {
  const joinRoom = useApp((s) => s.joinRoom);
  const isDesktop = useIsDesktop();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    onOpenChange(false);
    setPassword("");
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!card || busy || !password.trim()) return;
    setBusy(true);
    setError(null);
    const res = await joinRoom(card.roomId, password.trim());
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
    close();
  }

  return (
    <Sheet open={!!card} onOpenChange={(v) => (v ? null : close())}>
      <SheetContent
        side={isDesktop ? "right" : "bottom"}
        className="rounded-t-[18px] border-hairline bg-paper px-5 pb-8 pt-5 md:max-w-[440px] md:rounded-t-none md:rounded-l-[18px]"
      >
        <SheetHeader className="p-0 text-left">
          <SheetTitle className="t-title">{card?.localName ?? "Room"}</SheetTitle>
          <SheetDescription className="mt-1 font-sans text-[13px] leading-[19px] text-mute">
            This room is locked. Keys live only in memory — re-enter the
            password to return.
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="mt-5 space-y-4">
          <Field label="Room password" htmlFor="cc-unlock-pass" error={error}>
            <PasswordField
              id="cc-unlock-pass"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="room password"
              autoFocus
            />
          </Field>
          <PrimaryAction type="submit" full busy={busy}>
            {busy ? "Unlocking" : "Unlock"}
          </PrimaryAction>
        </form>
      </SheetContent>
    </Sheet>
  );
}
