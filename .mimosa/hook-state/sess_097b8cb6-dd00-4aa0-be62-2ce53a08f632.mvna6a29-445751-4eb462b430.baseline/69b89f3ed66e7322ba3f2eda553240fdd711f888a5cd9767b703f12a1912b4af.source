// S7: Key verification. The hardest security-UX problem, solved for
// someone who has never heard of a fingerprint: compare short codes,
// through another channel, and mark the people you've confirmed.

"use client";

import { useEffect, useState } from "react";
import { Check, ChevronRight, Copy } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { SheetGrabber } from "@/components/cc/sheet-grabber";
import { groupFingerprint, keyFingerprint } from "@/lib/identity";
import { loadVerified } from "@/lib/local";
import { getSession } from "@/lib/session";
import { useApp } from "@/store/app";
import type { MemberPublic } from "@/lib/types";

const EMPTY_MEMBERS: MemberPublic[] = [];
import { cn } from "@/lib/utils";

export function VerificationSheet({
  roomId,
  open,
  onOpenChange,
}: {
  roomId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const isDesktop = useIsDesktop();
  const members = useApp((s) => s.members[roomId] ?? EMPTY_MEMBERS);
  const markVerified = useApp((s) => s.markVerified);
  const session = getSession(roomId);
  const [glossary, setGlossary] = useState(false);
  const [fingerprints, setFingerprints] = useState<Record<string, string>>({});
  const [verifiedIds, setVerifiedIds] = useState<string[]>([]);

  // Fresh verification marks each time the sheet opens.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setVerifiedIds(loadVerified(roomId));
  }

  // Fingerprints are computed from each public key: deterministic,
  // the same for everyone who sees it.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      const entries = await Promise.all(
        members.map(async (m) => [m.memberId, await keyFingerprint(m.pubkey)] as const),
      );
      if (alive) setFingerprints(Object.fromEntries(entries));
    })();
    return () => {
      alive = false;
    };
  }, [open, members, roomId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isDesktop ? "right" : "bottom"}
        className="flex flex-col rounded-t-[18px] border-hairline bg-paper px-5 pb-8 pt-5 md:max-w-[440px] md:rounded-t-none md:rounded-l-[18px]"
      >
        {!isDesktop && <SheetGrabber />}
        <SheetHeader className="p-0 text-left">
          <SheetTitle className="t-title">Verify participants</SheetTitle>
          <SheetDescription className="mt-1 font-sans text-[13px] leading-[19px] text-mute">
            Each person here has a fingerprint, a short code made from their
            key. Compare it with them through another channel to be certain
            no one is impersonating them.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-5 flex-1 space-y-2 overflow-y-auto overscroll-contain scroll-quiet">
          {members.map((m) => (
            <VerifyRow
              key={m.memberId}
              member={m}
              fingerprint={fingerprints[m.memberId]}
              isSelf={m.memberId === session?.memberId}
              verified={verifiedIds.includes(m.memberId)}
              onToggle={() => {
                markVerified(roomId, m.memberId, !verifiedIds.includes(m.memberId));
                setVerifiedIds(loadVerified(roomId));
              }}
            />
          ))}
        </div>

        <div className="mt-5 border-t border-hairline pt-4">
          <button
            type="button"
            onClick={() => setGlossary((v) => !v)}
            aria-expanded={glossary}
            className="flex w-full items-center gap-1.5 rounded-[8px] py-2 font-sans text-[13px] font-medium text-mute transition-colors hover:text-charcoal"
          >
            <ChevronRight
              className={cn(
                "size-3.5 transition-transform duration-150",
                glossary && "rotate-90",
              )}
              aria-hidden
            />
            What is a fingerprint?
          </button>
          <div
            className={cn(
              "grid transition-all duration-200",
              glossary ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
            )}
          >
            <div className="overflow-hidden">
              <p className="pt-1 font-sans text-[12.5px] leading-[19px] text-mute">
                A fingerprint is a short code computed from someone&rsquo;s
                encryption key. Everyone in the room sees the same code for
                the same person. If the codes match when you compare them,
                no one is listening in between.
              </p>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function VerifyRow({
  member,
  fingerprint,
  isSelf,
  verified,
  onToggle,
}: {
  member: MemberPublic;
  fingerprint?: string;
  isSelf: boolean;
  verified: boolean;
  onToggle: () => void;
}) {
  const display = fingerprint ? groupFingerprint(fingerprint) : "···· ····";
  return (
    <div className="flex items-center gap-3 rounded-[12px] border border-hairline bg-side px-3.5 py-3">
      <span
        className="size-2.5 shrink-0 rounded-full"
        style={{ background: `var(--ink-${member.colorIdx})` }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p
          className="truncate font-serif text-[14.5px] font-medium"
          style={{ color: `var(--ink-${member.colorIdx})` }}
        >
          {member.alias}
          {isSelf ? <span className="text-mute"> · you</span> : null}
        </p>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="t-fingerprint text-[14px] text-charcoal">
            {display}
          </span>
          <button
            type="button"
            aria-label={`Copy ${member.alias}'s fingerprint`}
            onClick={() => {
              navigator.clipboard
                .writeText(display)
                .then(() => toast("Fingerprint copied"))
                .catch(() => toast("Select the code to copy it manually"));
            }}
            className="relative flex size-8 items-center justify-center rounded-[8px] text-mute transition-colors duration-150 hover:bg-wash hover:text-charcoal before:absolute before:-inset-2 before:content-['']"
          >
            <Copy className="size-3.5" aria-hidden />
          </button>
        </div>
      </div>
      {!isSelf ? (
        <button
          type="button"
          onClick={onToggle}
          role="switch"
          aria-checked={verified}
          aria-label={`Mark ${member.alias} as verified`}
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-[12px] border transition-colors duration-150",
            verified
              ? "border-forest/40 bg-forest/10 text-forest"
              : "border-hairline bg-paper text-mute hover:border-forest/30 hover:text-forest/80",
          )}
        >
          <Check className="size-[18px]" strokeWidth={2.5} aria-hidden />
        </button>
      ) : (
        <span className="size-11 shrink-0" aria-hidden />
      )}
    </div>
  );
}
