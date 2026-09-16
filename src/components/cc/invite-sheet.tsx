// The invite surface: the link and the password, with the standing
// advice to send them through different channels.

"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
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
import { getSession } from "@/lib/session";
import { useApp } from "@/store/app";
import { cn } from "@/lib/utils";

export function InviteSheet({
  roomId,
  open,
  onOpenChange,
}: {
  roomId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const isDesktop = useIsDesktop();
  const session = getSession(roomId);
  const [shown, setShown] = useState(false);
  const link = `${window.location.origin}/?join=${roomId}`;

  async function copy(value: string, what: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast(`${what} copied`);
    } catch {
      toast(`Select the ${what.toLowerCase()} to copy it manually`);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isDesktop ? "right" : "bottom"}
        className="rounded-t-[18px] border-hairline bg-paper px-5 pb-8 pt-5 md:max-w-[440px] md:rounded-t-none md:rounded-l-[18px]"
      >
        {!isDesktop && <SheetGrabber />}
        <SheetHeader className="p-0 text-left">
          <SheetTitle className="t-title">Invite to this room</SheetTitle>
          <SheetDescription className="mt-1 font-sans text-[13px] leading-[19px] text-mute">
            Send the link and the password through different channels —
            whoever holds both can enter.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-5 space-y-5">
          {/* Label row carries the actions; the value box below wraps
              freely — a long password never bends the layout. */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <p className="font-sans text-[13px] font-medium tracking-[0.01em] text-charcoal">
                Room link
              </p>
              <button
                type="button"
                onClick={() => copy(link, "Invite link")}
                className="-my-2 flex h-11 items-center gap-1.5 rounded-[8px] px-2 font-sans text-[12.5px] font-medium text-mute transition-colors duration-150 hover:bg-wash hover:text-charcoal"
              >
                <Copy className="size-3.5" aria-hidden />
                Copy
              </button>
            </div>
            <div className="rounded-[8px] border border-hairline bg-paper px-3.5 py-2.5">
              <span className="t-fingerprint break-all text-[12.5px] leading-[19px] text-charcoal">
                {link}
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <p className="font-sans text-[13px] font-medium tracking-[0.01em] text-charcoal">
                Room password
              </p>
              <span className="-my-2 flex items-center">
                <button
                  type="button"
                  onClick={() => setShown((v) => !v)}
                  className="flex h-11 items-center rounded-[8px] px-2 font-sans text-[12.5px] font-medium text-mute transition-colors duration-150 hover:bg-wash hover:text-charcoal"
                >
                  {shown ? "Hide" : "Show"}
                </button>
                <button
                  type="button"
                  onClick={() => copy(session?.password ?? "", "Password")}
                  className="flex h-11 items-center gap-1.5 rounded-[8px] px-2 font-sans text-[12.5px] font-medium text-mute transition-colors duration-150 hover:bg-wash hover:text-charcoal"
                >
                  <Copy className="size-3.5" aria-hidden />
                  Copy
                </button>
              </span>
            </div>
            <div className="rounded-[8px] border border-hairline bg-paper px-3.5 py-2.5">
              <span
                className={cn(
                  "t-fingerprint break-all text-[13px] leading-[20px] text-charcoal transition-colors duration-150",
                  shown && "select-all",
                )}
                aria-label={shown ? "Room password, revealed" : "Room password, hidden"}
              >
                {shown
                  ? session?.password
                  : "•".repeat(Math.min(24, session?.password.length ?? 8))}
              </span>
            </div>
            <p className="t-meta">
              The password lives in this room&rsquo;s memory only — it is never sent to us.
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
