// Actions. One primary verb per screen; forest means trust,
// terracotta means destruction — never the other way around.

"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type ActionProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean;
  full?: boolean;
};

const base =
  "inline-flex select-none items-center justify-center gap-2 rounded-[12px] font-sans text-[14px] font-medium tracking-[0.01em] transition duration-150 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.99] h-12 px-6";

export const PrimaryAction = forwardRef<HTMLButtonElement, ActionProps>(
  function PrimaryAction({ className, busy, full, children, disabled, ...props }, ref) {
    return (
      <button
        ref={ref}
        className={cn(
          base,
          "bg-forest text-paper hover:bg-forest-deep",
          full && "w-full",
          className,
        )}
        disabled={disabled || busy}
        {...props}
      >
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {children}
      </button>
    );
  },
);

export const SecondaryAction = forwardRef<HTMLButtonElement, ActionProps>(
  function SecondaryAction({ className, busy, full, children, disabled, ...props }, ref) {
    return (
      <button
        ref={ref}
        className={cn(
          base,
          "border border-hairline bg-side text-charcoal hover:border-forest/25 hover:bg-wash",
          full && "w-full",
          className,
        )}
        disabled={disabled || busy}
        {...props}
      >
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {children}
      </button>
    );
  },
);

export const DestructiveAction = forwardRef<HTMLButtonElement, ActionProps>(
  function DestructiveAction({ className, busy, full, children, disabled, ...props }, ref) {
    return (
      <button
        ref={ref}
        className={cn(
          base,
          "bg-terracotta text-paper hover:bg-terracotta-deep",
          full && "w-full",
          className,
        )}
        disabled={disabled || busy}
        {...props}
      >
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {children}
      </button>
    );
  },
);

/** Compact primary for header placement — still a 44px target. */
export const CompactAction = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement>
>(function CompactAction({ className, children, ...props }, ref) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex h-11 select-none items-center justify-center gap-2 rounded-[12px] bg-forest px-4 font-sans text-[13.5px] font-medium tracking-[0.01em] text-paper transition duration-150 hover:bg-forest-deep active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});

/** Quiet text action — never competes with the primary verb. */
export const QuietAction = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement>
>(function QuietAction({ className, children, ...props }, ref) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex h-11 select-none items-center justify-center rounded-[8px] px-3 font-sans text-[13.5px] font-medium text-mute transition-colors duration-150 hover:text-charcoal",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});
