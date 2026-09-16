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
import { getSession } from "@/lib/session";
import { useApp } from "@/store/app";

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
        <SheetHeader className="p-0 text-left">
          <SheetTitle className="t-title">Invite to this room</SheetTitle>
          <SheetDescription className="mt-1 font-sans text-[13px] leading-[19px] text-mute">
            Send the link and the password through different channels —
            whoever holds both can enter.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-5 space-y-5">
          <div className="space-y-1.5">
            <p className="font-sans text-[13px] font-medium tracking-[0.01em] text-charcoal">
              Room link
            </p>
            <div className="flex items-center justify-between gap-3 rounded-[8px] border border-hairline bg-paper px-3.5 py-2">
              <span className="t-fingerprint overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px] text-charcoal">
                {link}
              </span>
              <button
                type="button"
                onClick={() => copy(link, "Invite link")}
                className="flex h-11 shrink-0 items-center gap-1.5 rounded-[8px] px-2 font-sans text-[12.5px] font-medium text-mute transition-colors duration-150 hover:bg-wash hover:text-charcoal"
              >
                <Copy className="size-3.5" aria-hidden />
                Copy
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="font-sans text-[13px] font-medium tracking-[0.01em] text-charcoal">
              Room password
            </p>
            <div className="flex items-center justify-between gap-3 rounded-[8px] border border-hairline bg-paper px-3.5 py-2">
              <span className="t-fingerprint text-[13px] text-charcoal">
                {shown ? session?.password : "•".repeat(Math.min(24, session?.password.length ?? 8))}
              </span>
              <span className="flex shrink-0 items-center">
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
            <p className="t-meta">
              The password lives in this room&rsquo;s memory only — it is never sent to us.
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
