// S9 - Room settings. Minimal: a private label, a default lifetime,
// the people here. Burn sits at the bottom, separated by whitespace
// instead of a section header, never adjacent to anything tappable.

"use client";

import { useState } from "react";
import { Check, ChevronRight, Flag } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Field, TextField } from "@/components/cc/fields";
import { DestructiveAction, SecondaryAction } from "@/components/cc/actions";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { SheetGrabber } from "@/components/cc/sheet-grabber";
import { TtlPicker } from "@/components/cc/ttl-picker";
import { RoomTtlPicker } from "@/components/cc/room-ttl-picker";
import { useLegalSheet } from "@/components/cc/legal-sheet";
import { loadVerified } from "@/lib/local";
import { getSession } from "@/lib/session";
import { fmtTtlRemaining } from "@/lib/format";
import { useApp } from "@/store/app";
import type { MemberPublic } from "@/lib/types";

const EMPTY_MEMBERS: MemberPublic[] = [];

function AboutRow({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-11 w-full items-center justify-between rounded-[8px] px-1 text-left font-sans text-[13.5px] text-charcoal transition-colors duration-150 hover:bg-wash"
    >
      {label}
      <ChevronRight className="size-4 text-mute" aria-hidden />
    </button>
  );
}

export function SettingsSheet({
  roomId,
  open,
  onOpenChange,
}: {
  roomId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const isDesktop = useIsDesktop();
  const card = useApp((s) => s.roomCards.find((c) => c.roomId === roomId));
  const members = useApp((s) => s.members[roomId] ?? EMPTY_MEMBERS);
  const renameRoom = useApp((s) => s.renameRoom);
  const setDefaultTtl = useApp((s) => s.setDefaultTtl);
  const adjustRoomTtl = useApp((s) => s.adjustRoomTtl);
  const burnRoom = useApp((s) => s.burnRoom);
  const leaveRoom = useApp((s) => s.leaveRoom);
  const reportRoom = useApp((s) => s.reportRoom);
  const showLegal = useLegalSheet((s) => s.show);
  const session = getSession(roomId);
  const isCreator = !!session?.creatorToken;

  const [name, setName] = useState(card?.localName ?? "");
  const [ttl, setTtl] = useState(session?.defaultTtl ?? 0);
  const [roomTtl, setRoomTtl] = useState<number>(
    session?.expiresAt
      ? Math.max(0, Math.round((session.expiresAt - Date.now()) / 1000))
      : 0,
  );
  const [roomTtlBusy, setRoomTtlBusy] = useState(false);
  const [confirmBurn, setConfirmBurn] = useState(false);
  const [burning, setBurning] = useState(false);
  const [confirmReport, setConfirmReport] = useState(false);
  const [reporting, setReporting] = useState(false);

  // Re-seed the local fields each time the sheet opens (the
  // render-time adjustment pattern, no effects needed).
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName(card?.localName ?? "");
      setTtl(session?.defaultTtl ?? 0);
      setRoomTtl(
        session?.expiresAt
          ? Math.max(0, Math.round((session.expiresAt - Date.now()) / 1000))
          : 0,
      );
    }
  }

  const verifiedIds = loadVerified(roomId);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side={isDesktop ? "right" : "bottom"}
          className="flex flex-col overflow-y-auto overscroll-contain scroll-quiet rounded-t-[18px] border-hairline bg-paper px-5 pb-8 pt-5 md:max-w-[440px] md:rounded-t-none md:rounded-l-[18px]"
        >
        {!isDesktop && <SheetGrabber />}
          <SheetHeader className="p-0 text-left">
            <SheetTitle className="t-title">Room settings</SheetTitle>
            <SheetDescription className="mt-1 font-sans text-[13px] leading-[19px] text-mute">
              These settings live on this device only.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-5 space-y-5">
            <Field
              label="Room name (private to you)"
              htmlFor="cc-room-name"
              hint="Others may label this room differently. CipherChat never corrects this."
            >
              <TextField
                id="cc-room-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  renameRoom(roomId, e.target.value || "New room");
                }}
                maxLength={60}
              />
            </Field>

            <div className="space-y-2">
              <p className="font-sans text-[13px] font-medium tracking-[0.01em] text-charcoal">
                Default message lifetime
              </p>
              <TtlPicker
                value={ttl}
                onChange={(v) => {
                  setTtl(v);
                  setDefaultTtl(roomId, v);
                }}
              />
            </div>

            <div className="space-y-2">
              <p className="font-sans text-[13px] font-medium tracking-[0.01em] text-charcoal">
                Room lifetime
              </p>
              {isCreator ? (
                <RoomTtlPicker
                  value={roomTtl}
                  onChange={(v) => {
                    setRoomTtl(v);
                    setRoomTtlBusy(true);
                    void adjustRoomTtl(roomId, v).then((res) => {
                      setRoomTtlBusy(false);
                      if (res.ok) {
                        toast(v === 0 ? "The room now lives until burned" : "Room lifetime changed", {
                          description:
                            v === 0
                              ? "The clock is off; only the match remains."
                              : `Everyone will see it close in ${fmtTtlRemaining(v * 1000)}.`,
                        });
                      } else {
                        toast("The lifetime couldn't be changed", {
                          description:
                            res.reason === "room-expired"
                              ? "The room's time already ran out."
                              : "Check your connection and try again.",
                        });
                      }
                    });
                  }}
                />
              ) : (
                <p className="t-meta" role="status">
                  {roomTtl > 0
                    ? `This room closes in ${fmtTtlRemaining(roomTtl * 1000)}.`
                    : "This room lives until it's burned."}
                  {roomTtlBusy ? " Saving…" : ""}
                </p>
              )}
              {isCreator ? (
                <p className="t-meta">Only you can change this. The clock belongs to the room's creator.</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <p className="font-sans text-[13px] font-medium tracking-[0.01em] text-charcoal">
                People here
              </p>
              <ul className="space-y-1">
                {members.map((m) => (
                  <li
                    key={m.memberId}
                    className="flex items-center gap-2.5 rounded-[8px] px-1 py-1.5"
                  >
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: `var(--ink-${m.colorIdx})` }}
                      aria-hidden
                    />
                    <span
                      className="flex-1 truncate font-serif text-[14px] font-medium"
                      style={{ color: `var(--ink-${m.colorIdx})` }}
                    >
                      {m.alias}
                      {m.memberId === session?.memberId ? (
                        <span className="text-mute"> · you</span>
                      ) : null}
                    </span>
                    {verifiedIds.includes(m.memberId) ? (
                      <Check
                        className="size-4 text-forest"
                        aria-label="Verified"
                        strokeWidth={2.5}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-2">
              <p className="font-sans text-[13px] font-medium tracking-[0.01em] text-charcoal">
                About
              </p>
              <div className="space-y-0.5">
                <AboutRow
                  label="Terms of Use"
                  onClick={() => showLegal("terms")}
                />
                <AboutRow
                  label="Privacy Policy"
                  onClick={() => showLegal("privacy")}
                />
              </div>
              <p className="t-meta">
                What you agree to, and what the server does (and does not) hold.
              </p>
            </div>
          </div>

          {/* Burn - separated by whitespace, not a header. Somber. */}
          <div className="mt-12 pb-2">
            {isCreator ? (
              <DestructiveAction full onClick={() => setConfirmBurn(true)}>
                Burn this room
              </DestructiveAction>
            ) : (
              <SecondaryAction full onClick={() => leaveRoom(roomId)}>
                Leave room
              </SecondaryAction>
            )}
            <p className="t-meta mt-2 text-center">
              {isCreator
                ? "Burning destroys the room for everyone, unrecoverably."
                : "When you leave, those who stay re-seal the room under a new key you will never receive."}
            </p>
          </div>

          {/* Report abuse: the graded path (Task 32). A member's
              report is SIGNED with the room key and ends the room at
              once; a stranger's needs three networks' corroboration.
              Members only (the creator already holds burn); separated
              from Leave by whitespace, somber, never crowding it. */}
          {!isCreator && session ? (
            <div className="mt-6 pb-2">
              <button
                type="button"
                onClick={() => setConfirmReport(true)}
                className="mx-auto flex h-11 items-center gap-2 rounded-[8px] px-3 font-sans text-[13px] text-mute transition-colors duration-150 hover:bg-wash hover:text-charcoal"
              >
                <Flag className="size-4" aria-hidden />
                Report this room
              </button>
              <p className="t-meta mt-1 text-center">
                For misuse, not manners: a member&rsquo;s report is signed with
                their room key and ends the room at once.
              </p>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      {/* Irreversible - the only centered modals in the product. */}
      <Dialog open={confirmBurn} onOpenChange={setConfirmBurn}>
        <DialogContent className="max-w-[400px] rounded-[18px] border-hairline bg-paper p-6 shadow-float">
          <DialogHeader className="p-0 text-left">
            <DialogTitle className="t-title">Burn this room?</DialogTitle>
            <DialogDescription className="mt-2 font-sans text-[13.5px] leading-[20px] text-charcoal/80">
              This destroys the room and its messages for everyone. This
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-6 flex flex-col gap-2 sm:flex-col">
            <DestructiveAction
              full
              busy={burning}
              onClick={async () => {
                setBurning(true);
                await burnRoom(roomId);
                setBurning(false);
                setConfirmBurn(false);
                onOpenChange(false);
              }}
            >
              {burning ? "Burning" : "Burn the room"}
            </DestructiveAction>
            <SecondaryAction full onClick={() => setConfirmBurn(false)}>
              Cancel
            </SecondaryAction>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Report - also irreversible, also centered. */}
      <Dialog open={confirmReport} onOpenChange={setConfirmReport}>
        <DialogContent className="max-w-[400px] rounded-[18px] border-hairline bg-paper p-6 shadow-float">
          <DialogHeader className="p-0 text-left">
            <DialogTitle className="t-title">Report this room?</DialogTitle>
            <DialogDescription className="mt-2 font-sans text-[13.5px] leading-[20px] text-charcoal/80">
              Your report is signed with your room key, so it acts at
              once: the room ends for everyone, immediately. It cannot
              unsend anything: nothing is kept. To add detail, or to
              reach the project author for anything the room itself cannot
              fix, write to lilice308@gmail.com.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-6 flex flex-col gap-2 sm:flex-col">
            <DestructiveAction
              full
              busy={reporting}
              onClick={async () => {
                setReporting(true);
                await reportRoom(roomId);
                setReporting(false);
                setConfirmReport(false);
                onOpenChange(false);
              }}
            >
              {reporting ? "Sending" : "Send the report"}
            </DestructiveAction>
            <SecondaryAction full onClick={() => setConfirmReport(false)}>
              Cancel
            </SecondaryAction>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
