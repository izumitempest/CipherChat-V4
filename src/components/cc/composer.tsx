// The composer. A floating slip of paper over the conversation:
// backdrop-blur (one of exactly two blurred surfaces), auto-growing
// input, attach, TTL cycle, send. When the connection drops, the
// send button becomes "Reconnecting…" — you never type into a void
// silently.

"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Eye, Hourglass, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { FILE_LIMIT, useApp } from "@/store/app";
import { getSession } from "@/lib/session";
import { ttlHintSeen } from "@/lib/local";
import { getDraft, setDraft } from "@/lib/drafts";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { TTL_STEPS, isCustomTtl, type TtlChoice } from "@/lib/types";
import { fmtBytes, fmtTtlLong, fmtTtlShort } from "@/lib/format";
import { TtlPicker } from "@/components/cc/ttl-picker";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { SheetGrabber } from "@/components/cc/sheet-grabber";
import { cn } from "@/lib/utils";

export interface Attachment {
  name: string;
  mime: string;
  size: number;
  dataB64: string;
}

export const MESSAGE_CHAR_LIMIT = 4000;

export function Composer({ onTtlArmed }: { onTtlArmed?: () => void }) {
  const roomId = useApp((s) => s.activeRoomId);
  const sendMessage = useApp((s) => s.sendMessage);
  const emitTyping = useApp((s) => s.emitTyping);
  const relayOnline = useApp((s) => s.relayOnline);
  const resealing = useApp((s) => (roomId ? s.resealing[roomId] : false));
  const isDesktop = useIsDesktop();

  // The draft belongs to the ROOM, not the composer: switching rooms
  // swaps in each room's letter-in-progress (memory-only, like the
  // keys — a refresh wipes it with everything else).
  const [text, setText] = useState(() => (roomId ? getDraft(roomId) : ""));
  // A restored letter-in-progress announces itself once with a soft
  // forest ring — set at mount (a room switch remounts the composer)
  // and on any later render-time swap, cleared when the pulse ends.
  const [draftCue, setDraftCue] = useState(() =>
    !!(roomId ? getDraft(roomId) : "").trim(),
  );
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [viewOnce, setViewOnce] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  // Keyed by room — fresh state per room, seeded from its local setting.
  const [ttl, setTtl] = useState<TtlChoice>(() =>
    roomId ? (getSession(roomId)?.defaultTtl ?? 0) : 0,
  );
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /* One dispatch, one flourish: two small flecks rise from the send
   * button as the letter leaves. Cleared by the pseudo-elements'
   * animationend, which lands on the button itself. */
  const [bursting, setBursting] = useState(false);

  // A room switch swaps in that room's letter-in-progress and its own
  // expiry setting — adjusted during render (the sanctioned no-effect
  // pattern for prop-driven state), while the cursor courtesy is a
  // DOM effect below. Touch keyboards stay closed: nothing should
  // jump at you on a phone.
  const [prevRoomId, setPrevRoomId] = useState(roomId);
  if (prevRoomId !== roomId) {
    setPrevRoomId(roomId);
    const next = roomId ? getDraft(roomId) : "";
    setText(next);
    setTtl(roomId ? (getSession(roomId)?.defaultTtl ?? 0) : 0);
    setDraftCue(!!next.trim());
  }

  useEffect(() => {
    if (roomId && isDesktop) inputRef.current?.focus();
  }, [roomId, isDesktop]);

  // Auto-grow: 1 to 3 lines.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    const h = Math.min(el.scrollHeight, 66);
    el.style.height = `${Math.max(24, h)}px`;
  }, [text]);

  const disabled = !relayOnline || !!resealing;
  const canSend = !disabled && (text.trim().length > 0 || !!attachment);

  // The lifetime chooser: a small anchored popover on the desk,
  // a bottom sheet in the hand. Either way, the same picker.
  const [ttlOpen, setTtlOpen] = useState(false);

  function chooseTtl(next: number) {
    setTtl(next);
    if (next !== 0) {
      // The first time a timer is armed, the quiet strip above the
      // composer explains what expiry means — instead of a toast.
      if (!ttlHintSeen() && onTtlArmed) onTtlArmed();
      else if (ttl !== next) toast(`Messages now expire in ${fmtTtlLong(next)}`);
    }
  }

  // The hourglass itself — seated bare in the hand, anchored under
  // a popover at the desk.
  const ttlTrigger = (
    <button
      type="button"
      onClick={() => setTtlOpen(true)}
      disabled={disabled}
      aria-label={
        ttl === 0
          ? "Set message expiry: off"
          : `Message expiry ${fmtTtlLong(ttl)}. Tap to change`
      }
      aria-pressed={ttl !== 0}
      className={cn(
        "flex h-11 shrink-0 items-center gap-1.5 rounded-[6px] border px-2 font-sans text-[12px] font-medium transition duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-50",
        ttl !== 0
          ? "border-terracotta/40 text-terracotta hover:border-terracotta/60"
          : "border-hairline text-mute hover:border-forest/25 hover:text-charcoal",
      )}
    >
      <Hourglass className="size-3.5" aria-hidden />
      <span className={ttl === 0 ? "sr-only" : undefined}>
        {isCustomTtl(ttl) ? fmtTtlShort(ttl) : TTL_STEPS.find((s) => s.value === ttl)?.short}
      </span>
    </button>
  );

  async function pickFile(file: File | undefined) {
    if (!file) return;
    if (file.size > FILE_LIMIT) {
      toast(`Files can be up to ${fmtBytes(FILE_LIMIT)}`);
      return;
    }
    const buf = new Uint8Array(await file.arrayBuffer());
    let s = "";
    const CHUNK = 8192;
    for (let i = 0; i < buf.length; i += CHUNK) {
      s += String.fromCharCode(...buf.subarray(i, i + CHUNK));
    }
    setAttachment({
      name: file.name,
      mime: file.type || "application/octet-stream",
      size: file.size,
      dataB64: btoa(s),
    });
  }

  /** Files can arrive three ways: the paperclip, a paste, a drop. */
  function takeEventFiles(list: FileList | null) {
    const file = list?.[0];
    if (file) void pickFile(file);
  }

  async function submit() {
    if (!canSend || !roomId) return;
    setBursting(true);
    const file = attachment
      ? { ...attachment, viewOnce }
      : undefined;
    const sending = text;
    const ttlNow = ttl;
    setText("");
    setAttachment(null);
    setViewOnce(false);
    setDraft(roomId, ""); // the letter left with its sender
    inputRef.current?.focus();
    await sendMessage(sending, file, ttlNow);
  }

  const nearLimit = text.length > MESSAGE_CHAR_LIMIT - 200;
  const charsLeft = MESSAGE_CHAR_LIMIT - text.length;

  return (
    <div
      className={cn(
        "composer-blur sticky bottom-0 z-20 border-t shadow-float",
        dragOver ? "border-forest/45" : "border-hairline",
      )}
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (disabled) return;
        takeEventFiles(e.dataTransfer.files);
      }}
    >
      {/* the drop slip — paper waiting to receive */}
      {dragOver ? (
        <div className="mx-auto w-full max-w-[720px] px-3 pt-3">
          <div className="settle flex h-16 items-center justify-center rounded-[12px] border border-dashed border-forest/40 bg-wash font-sans text-[13px] font-medium text-forest">
            <Paperclip className="mr-2 size-4" aria-hidden />
            Release to attach
          </div>
        </div>
      ) : null}
      <div className="mx-auto w-full max-w-[720px] px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        {/* attachment slip */}
        {attachment ? (
          <div className="settle mb-2 flex items-center gap-2.5 rounded-[10px] border border-hairline bg-side px-2.5 py-2">
            <span
              className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-paper text-mute"
              aria-hidden
            >
              <Paperclip className="size-3.5" />
            </span>
            <span className="min-w-0 flex-1 truncate font-sans text-[12.5px] text-charcoal">
              {attachment.name}
              <span className="text-mute"> · {fmtBytes(attachment.size)}</span>
            </span>
            <button
              type="button"
              onClick={() => setViewOnce((v) => !v)}
              aria-pressed={viewOnce}
              className={cn(
                "relative flex h-8 items-center gap-1.5 rounded-[6px] border px-2 font-sans text-[12px] font-medium transition-colors duration-150 before:absolute before:-inset-x-1.5 before:-inset-y-2 before:content-['']",
                viewOnce
                  ? "border-terracotta/40 text-terracotta hover:border-terracotta/60"
                  : "border-hairline text-mute hover:border-forest/25 hover:text-charcoal",
              )}
            >
              <Eye className="size-3.5" aria-hidden />
              View once
            </button>
            <button
              type="button"
              aria-label="Remove attachment"
              onClick={() => setAttachment(null)}
              className="relative flex size-8 items-center justify-center rounded-[8px] text-mute transition-colors duration-150 hover:bg-wash hover:text-charcoal before:absolute before:-inset-2 before:content-['']"
            >
              <X className="size-4" />
            </button>
          </div>
        ) : null}

        <div className="flex items-end gap-1.5">
          <button
            type="button"
            aria-label="Attach a file"
            disabled={disabled}
            onClick={() => fileRef.current?.click()}
            className="group flex size-11 shrink-0 items-center justify-center rounded-[12px] text-mute transition-colors duration-150 hover:bg-wash hover:text-charcoal disabled:pointer-events-none disabled:opacity-50"
          >
            <Paperclip className="size-[18px] transition-transform duration-150 group-hover:rotate-[10deg]" />
          </button>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              pickFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />

          <textarea
            ref={inputRef}
            rows={1}
            value={text}
            disabled={disabled}
            maxLength={MESSAGE_CHAR_LIMIT}
            onChange={(e) => {
              setText(e.target.value);
              if (roomId) setDraft(roomId, e.target.value);
              if (e.target.value.trim()) emitTyping(roomId ?? "");
            }}
            onPaste={(e) => {
              const files = e.clipboardData?.files;
              if (files && files.length > 0) {
                e.preventDefault();
                takeEventFiles(files);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            onAnimationEnd={() => setDraftCue(false)}
            placeholder="Write a message…"
            aria-label="Message"
            aria-describedby={nearLimit ? "cc-char-count" : undefined}
            className={cn(
              "max-h-[66px] min-h-[44px] flex-1 resize-none rounded-[12px] border border-hairline bg-paper px-3.5 py-[11px] font-serif text-[15.5px] leading-[22px] text-charcoal transition-colors duration-150 placeholder:text-mute/70 focus:border-forest/45 focus:outline-none focus:ring-2 focus:ring-forest/15 disabled:cursor-not-allowed disabled:opacity-50",
              draftCue && "draft-restored",
            )}
          />

          {isDesktop ? (
            <Popover open={ttlOpen} onOpenChange={setTtlOpen}>
              <PopoverAnchor asChild>
                {ttlTrigger}
              </PopoverAnchor>
              <PopoverContent
                align="end"
                className="w-[320px] rounded-[14px] border-hairline bg-paper p-3.5 shadow-float"
              >
                <p className="mb-2.5 font-sans text-[13px] font-medium tracking-[0.01em] text-charcoal">
                  Message expiry
                </p>
                <TtlPicker value={ttl} onChange={chooseTtl} />
              </PopoverContent>
            </Popover>
          ) : (
            <>
              {ttlTrigger}
              <Sheet open={ttlOpen} onOpenChange={setTtlOpen}>
                <SheetContent
                  side="bottom"
                  aria-describedby={undefined}
                  className="rounded-t-[18px] border-t border-hairline bg-paper px-5 pb-8 pt-2"
                >
                  <SheetGrabber />
                  {/* Screen-reader title for the sheet (visually the
                      label below carries it). */}
                  <SheetTitle className="sr-only">Message expiry</SheetTitle>
                  <p className="mb-2.5 font-sans text-[13px] font-medium tracking-[0.01em] text-charcoal">
                    Message expiry
                  </p>
                  <TtlPicker value={ttl} onChange={chooseTtl} />
                </SheetContent>
              </Sheet>
            </>
          )}

          {disabled ? (
            <span
              className="flex h-11 shrink-0 items-center gap-2 rounded-[12px] border border-hairline bg-side px-3 font-sans text-[12.5px] font-medium text-mute"
              role="status"
            >
              <span className="dot-pulse size-1.5 rounded-full bg-mute" aria-hidden />
              {resealing ? "Re-sealing" : "Reconnecting"}
            </span>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              aria-label="Send message"
              onAnimationEnd={() => setBursting(false)}
              className={cn(
                "relative flex size-11 shrink-0 items-center justify-center rounded-[12px] bg-forest text-paper transition duration-150 hover:bg-forest-deep active:scale-[0.96] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-forest/45 focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:pointer-events-none disabled:opacity-50",
                bursting && "send-burst",
              )}
            >
              <ArrowUp className="size-[18px]" strokeWidth={2.25} />
            </button>
          )}
        </div>
        {nearLimit ? (
          <p
            id="cc-char-count"
            className={cn(
              "t-meta mt-1.5 text-right",
              charsLeft <= 0 && "text-terracotta/70",
            )}
            aria-live="polite"
          >
            {charsLeft <= 0
              ? "At the limit — the message is as long as a letter can be"
              : `${charsLeft} characters left`}
          </p>
        ) : null}
      </div>
    </div>
  );
}
