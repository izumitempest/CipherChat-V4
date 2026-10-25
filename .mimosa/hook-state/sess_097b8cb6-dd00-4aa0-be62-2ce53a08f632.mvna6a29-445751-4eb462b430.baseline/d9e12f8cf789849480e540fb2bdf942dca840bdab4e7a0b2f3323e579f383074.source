// The notice stack: in-app notifications that behave like paper,
// not like popups. A banner never covers anything: it takes its seat
// at the top of the shell and everything below steps down to make
// room (the grid-rows 0fr→1f opening is the same mechanic as a
// bottom sheet, turned upside down).
//
// While it is on stage it publishes its height as --cc-notice-h on
// <html>, so toasts seat BELOW the banner instead of over it. The
// top of the screen belongs to one thing at a time.
//
// Motion lives in globals.css (notice-open / notice-close), which
// keeps it inside the project's reduced-motion discipline.

"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { InkMark } from "@/components/cc/mark";
import { useNoticeStack } from "@/store/notices";
import { useApp } from "@/store/app";
import { bannerLine, loadNotifyPreview } from "@/lib/notifications";
import { cn } from "@/lib/utils";

export function NoticeStack() {
  const banners = useNoticeStack((s) => s.banners);
  const dismiss = useNoticeStack((s) => s.dismiss);
  const remove = useNoticeStack((s) => s.remove);
  const navigate = useApp((s) => s.navigate);
  const stackRef = useRef<HTMLDivElement>(null);

  // The stack's height, published for the toast viewport. ResizeObserver
  // rather than a state mirror: the height animates, and toasts should
  // track it live.
  useEffect(() => {
    const el = stackRef.current;
    const root = document.documentElement;
    if (!el || typeof ResizeObserver === "undefined") return;
    const publish = () =>
      root.style.setProperty("--cc-notice-h", `${Math.round(el.offsetHeight)}px`);
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    publish();
    return () => {
      ro.disconnect();
      root.style.setProperty("--cc-notice-h", "0px");
    };
  }, []);

  // The preview preference, read as each banner renders. Flipping the
  // setting changes what the next banner says, immediately.
  const pref = loadNotifyPreview();

  return (
    <div
      ref={stackRef}
      className={cn(
        "sticky top-0 z-30 shrink-0",
        // The safe area is the banner's to carry: only when a banner
        // is on stage does the stack claim it (an empty stack must
        // hold no space at all).
        banners.length > 0 && "bg-paper pt-[env(safe-area-inset-top)]",
      )}
    >
      {banners.map((b) => (
        <div
          key={b.key}
          data-leaving={b.leaving ? "true" : undefined}
          className="notice-row"
          onAnimationEnd={(e) => {
            if (b.leaving && e.animationName === "notice-close") {
              remove(b.key);
            }
          }}
        >
          <div className="notice-row-inner">
            <div className="mx-auto w-full max-w-[min(560px,calc(100%-16px))] px-2 pt-2">
              <div
                role="button"
                tabIndex={0}
                aria-label={`Open ${b.roomName || "room"}: new letter from ${b.alias}`}
                onClick={() => {
                  navigate("chat", b.roomId);
                  dismiss(b.key);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate("chat", b.roomId);
                    dismiss(b.key);
                  }
                }}
                className="notice-card flex w-full cursor-pointer items-center gap-3 rounded-[14px] border border-hairline bg-paper px-3 py-2.5 text-left shadow-float transition-colors duration-150 hover:bg-wash focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-forest/40 active:scale-[0.99]"
              >
                {/* The writer's ink, worn as a fleck. */}
                <span
                  aria-hidden
                  className="flex size-9 shrink-0 items-center justify-center rounded-full border border-hairline bg-side"
                  style={{ color: `var(--ink-${b.colorIdx})` }}
                >
                  <InkMark variant="fleck" size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1.5">
                    <span
                      className="truncate font-serif text-[14px] font-semibold leading-[18px]"
                      style={{ color: `var(--ink-${b.colorIdx})` }}
                    >
                      {b.alias}
                    </span>
                    <span
                      aria-hidden
                      className="truncate font-sans text-[11.5px] text-mute"
                    >
                      · {b.roomName || "a room"}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate font-sans text-[12.5px] leading-[17px] text-mute">
                    {bannerLine(b, pref)}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label="Dismiss"
                  onClick={(e) => {
                    e.stopPropagation();
                    dismiss(b.key);
                  }}
                  className="flex size-7 shrink-0 items-center justify-center rounded-full text-mute/70 transition-colors duration-150 hover:bg-wash hover:text-charcoal"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
