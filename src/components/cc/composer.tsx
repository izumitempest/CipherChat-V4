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
import { TTL_STEPS, type TtlChoice } from "@/lib/types";
import { fmtBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface Attachment {
  name: string;
  mime: string;
  size: number;
  dataB64: string;
}

export function Composer() {
  const roomId = useApp((s) => s.activeRoomId);
  const sendMessage = useApp((s) => s.sendMessage);
  const relayOnline = useApp((s) => s.relayOnline);
  const resealing = useApp((s) => (roomId ? s.resealing[roomId] : false));

  const [text, setText] = useState("");
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [viewOnce, setViewOnce] = useState(false);
  // Keyed by room — fresh state per room, seeded from its local setting.
  const [ttl, setTtl] = useState<TtlChoice>(() =>
    roomId ? (getSession(roomId)?.defaultTtl ?? 0) : 0,
  );
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  function cycleTtl() {
    const idx = TTL_STEPS.findIndex((s) => s.value === ttl);
    const next = TTL_STEPS[(idx + 1) % TTL_STEPS.length];
    setTtl(next.value);
    if (next.value !== 0) {
      toast(`Messages now expire in ${next.label.toLowerCase()}`);
    }
  }

  async function pickFile(file: File | undefined) {
    if (!file) return;
    if (file.size > FILE_LIMIT) {
      toast(`Files can be up to ${fmtBytes(FILE_LIMIT)}`);
      return;
    }
    const buf = new Uint8Array(await file.arrayBuffer());
    let s = "";
    for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
    setAttachment({
      name: file.name,
      mime: file.type || "application/octet-stream",
      size: file.size,
      dataB64: btoa(s),
    });
  }

  async function submit() {
    if (!canSend || !roomId) return;
    const file = attachment
      ? { ...attachment, viewOnce }
      : undefined;
    const sending = text;
    const ttlNow = ttl;
    setText("");
    setAttachment(null);
    setViewOnce(false);
    inputRef.current?.focus();
    await sendMessage(sending, file, ttlNow);
  }

  return (
    <div className="composer-blur sticky bottom-0 z-20 border-t border-hairline shadow-float">
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
            className="flex size-11 shrink-0 items-center justify-center rounded-[12px] text-mute transition-colors duration-150 hover:bg-wash hover:text-charcoal disabled:pointer-events-none disabled:opacity-50"
          >
            <Paperclip className="size-[18px]" />
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
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Write a message…"
            aria-label="Message"
            className="max-h-[66px] min-h-[44px] flex-1 resize-none rounded-[12px] border border-hairline bg-paper px-3.5 py-[11px] font-serif text-[15.5px] leading-[22px] text-charcoal transition-colors duration-150 placeholder:text-mute/70 focus:border-forest/45 focus:outline-none focus:ring-2 focus:ring-forest/15 disabled:cursor-not-allowed disabled:opacity-50"
          />

          <button
            type="button"
            onClick={cycleTtl}
            disabled={disabled}
            aria-label={
              ttl === 0
                ? "Set message expiry: off"
                : `Message expiry ${TTL_STEPS.find((s) => s.value === ttl)?.label}. Tap to change`
            }
            aria-pressed={ttl !== 0}
            className={cn(
              "flex h-11 shrink-0 items-center gap-1.5 rounded-[6px] border px-2 font-sans text-[12px] font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50",
              ttl !== 0
                ? "border-terracotta/40 text-terracotta hover:border-terracotta/60"
                : "border-hairline text-mute hover:border-forest/25 hover:text-charcoal",
            )}
          >
            <Hourglass className="size-3.5" aria-hidden />
            <span className={ttl === 0 ? "sr-only" : undefined}>
              {TTL_STEPS.find((s) => s.value === ttl)?.short}
            </span>
          </button>

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
              className="flex size-11 shrink-0 items-center justify-center rounded-[12px] bg-forest text-paper transition duration-150 hover:bg-forest-deep active:scale-[0.96] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-forest/45 focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:pointer-events-none disabled:opacity-50"
            >
              <ArrowUp className="size-[18px]" strokeWidth={2.25} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
