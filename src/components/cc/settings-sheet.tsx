// S9 - Room settings. Minimal: a private label, a default lifetime,
// the people here. Burn sits at the bottom, separated by whitespace
// instead of a section header, never adjacent to anything tappable.

"use client";

import { useRef, useState } from "react";
import { Check, ChevronRight } from "lucide-react";
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
import { Field, PasswordField, TextField } from "@/components/cc/fields";
import { DestructiveAction, PrimaryAction, SecondaryAction } from "@/components/cc/actions";
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
import { cn } from "@/lib/utils";

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
  const setStoreCoverTraffic = useApp((s) => s.setCoverTraffic);
  const showLegal = useLegalSheet((s) => s.show);
  const session = getSession(roomId);
  const isCreator = !!session?.creatorToken;

  const [name, setName] = useState(card?.localName ?? "");
  const [ttl, setTtl] = useState(session?.defaultTtl ?? 0);
  const [coverTraffic, setCoverTraffic] = useState(!!session?.coverTraffic);
  const [roomTtl, setRoomTtl] = useState<number>(
    session?.expiresAt
      ? Math.max(0, Math.round((session.expiresAt - Date.now()) / 1000))
      : 0,
  );
  const [roomTtlBusy, setRoomTtlBusy] = useState(false);
  const [confirmBurn, setConfirmBurn] = useState(false);
  const [burning, setBurning] = useState(false);
  const newPasswordRef = useRef<HTMLInputElement>(null);
  const [changingPassword, setChangingPassword] = useState(false);
  const changePassword = useApp((s) => s.changePassword);
  const upgradeRoom = useApp((s) => s.upgradeRoom);
  const upgradePasswordRef = useRef<HTMLInputElement>(null);
  const [upgrading, setUpgrading] = useState(false);

  // Re-seed the local fields each time the sheet opens (the
  // render-time adjustment pattern, no effects needed).
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName(card?.localName ?? "");
      setTtl(session?.defaultTtl ?? 0);
      setCoverTraffic(!!session?.coverTraffic);
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
              {roomTtl === 0 ? (
                <p className="t-meta">
                  A room with no clock is swept after a year if nobody is in it.
                </p>
              ) : null}
            </div>

            {isCreator ? (
              <div className="space-y-2">
                <p className="font-sans text-[13px] font-medium tracking-[0.01em] text-charcoal">
                  Room password
                </p>
                <p className="t-meta">
                  Changing the password rotates the room's entry key.
                  Everyone who needs to keep using the room must re-join
                  with the new password. Keys already delivered over
                  ECDH are unaffected.
                </p>
                <Field label="New password" htmlFor="cc-room-password">
                  <PasswordField
                    ref={newPasswordRef}
                    id="cc-room-password"
                    placeholder="New room password"
                    required
                  />
                </Field>
                <PrimaryAction
                  full
                  busy={changingPassword}
                  onClick={async () => {
                    const password = newPasswordRef.current?.value ?? "";
                    if (!password.trim()) return;
                    setChangingPassword(true);
                    const res = await changePassword(roomId, password.trim());
                    setChangingPassword(false);
                    if (newPasswordRef.current) newPasswordRef.current.value = "";
                    if (res.ok) {
                      toast("Entry key rotated", {
                        description:
                          "Re-join this room with the new password on any other device.",
                      });
                    } else {
                      toast("The password could not be changed", {
                        description:
                          res.reason === "not-creator"
                            ? "Only the room's creator can rotate the password."
                            : "The server did not answer. Try again.",
                      });
                    }
                  }}
                >
                  {changingPassword ? "Rotating" : "Rotate entry key"}
                </PrimaryAction>
              </div>
            ) : null}

            {session?.legacy && isCreator ? (
              <div className="space-y-2">
                <p className="font-sans text-[13px] font-medium tracking-[0.01em] text-charcoal">
                  Upgrade room security
                </p>
                <p className="t-meta">
                  This room was sealed before password proof existed.
                  Anyone with the link can join and the roster is
                  visible to link holders. Upgrading requires proof of
                  the room password to join thereafter and hides the
                  roster behind that proof.
                </p>
                <Field label="Current room password" htmlFor="cc-room-upgrade-pass">
                  <PasswordField
                    ref={upgradePasswordRef}
                    id="cc-room-upgrade-pass"
                    placeholder="Current room password"
                    required
                  />
                </Field>
                <PrimaryAction
                  full
                  busy={upgrading}
                  onClick={async () => {
                    const password = upgradePasswordRef.current?.value ?? "";
                    if (!password.trim()) return;
                    setUpgrading(true);
                    try {
                      const { createKeyBundleV2 } = await import("@/lib/kdf");
                      const { bundle, joinVerifier } = await createKeyBundleV2(
                        password.trim(),
                        roomId,
                      );
                      const verifier = JSON.stringify(bundle);
                      const res = await upgradeRoom(
                        roomId,
                        verifier,
                        joinVerifier,
                        session?.creatorToken ?? "",
                      );
                      if (upgradePasswordRef.current) {
                        upgradePasswordRef.current.value = "";
                      }
                      setUpgrading(false);
                      if (res.ok) {
                        toast("Room upgraded", {
                          description:
                            "Joining now requires proof of the room password.",
                        });
                      } else {
                        toast("The room could not be upgraded", {
                          description:
                            res.reason === "not-creator"
                              ? "Only the room's creator can upgrade."
                              : "The server did not answer. Try again.",
                        });
                      }
                    } catch {
                      setUpgrading(false);
                      toast("The room could not be upgraded", {
                        description: "Failed to derive the key bundle.",
                      });
                    }
                  }}
                >
                  {upgrading ? "Upgrading" : "Upgrade room security"}
                </PrimaryAction>
              </div>
            ) : null}

            <div className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-sans text-[13px] font-medium tracking-[0.01em] text-charcoal">
                    Cover traffic
                  </p>
                  <p className="t-meta mt-0.5 leading-[17px]">
                    While this room is open, this device sends a signed,
                    encrypted, message-sized frame every 8–10 seconds
                    whether or not you are typing. The relay sees a
                    constant-rate stream instead of a silence between
                    letters. Receivers discard it.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={coverTraffic}
                  aria-label={`Cover traffic: ${coverTraffic ? "on" : "off"}`}
                  onClick={() => {
                    const next = !coverTraffic;
                    setCoverTraffic(next);
                    setStoreCoverTraffic(roomId, next);
                  }}
                  className={cn(
                    "relative mt-0.5 h-6 w-10 shrink-0 rounded-full border transition-colors duration-150",
                    coverTraffic
                      ? "border-forest bg-forest"
                      : "border-hairline bg-side hover:border-forest/25",
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-1/2 size-4 -translate-y-1/2 rounded-full bg-paper shadow-sm transition-all duration-150",
                      coverTraffic ? "left-[22px]" : "left-1",
                    )}
                  />
                </button>
              </div>
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
                const res = await burnRoom(roomId);
                setBurning(false);
                setConfirmBurn(false);
                if (!res.ok) {
                  // The room is still alive. The burn screen did not
                  // come up, so the room stays open and the sheet
                  // closes over it.
                  toast("The room did not burn", {
                    description:
                      res.reason === "refused"
                        ? "The server refused it. The room is still open."
                        : "The server did not answer. The room is still open.",
                  });
                  return;
                }
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

    </>
  );
}
