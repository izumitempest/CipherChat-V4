// Inputs. Paper surfaces, hairline borders, forest focus. Errors are
// neutral charcoal — only actions carry color.

"use client";

import {
  forwardRef,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label?: string;
  hint?: ReactNode;
  error?: string | null;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      {label ? (
        <label
          htmlFor={htmlFor}
          className="block font-sans text-[13px] font-medium tracking-[0.01em] text-charcoal"
        >
          {label}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="font-sans text-[12.5px] leading-[18px] text-charcoal" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="t-meta">{hint}</p>
      ) : null}
    </div>
  );
}

export const TextField = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function TextField({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-12 w-full rounded-[8px] border border-hairline bg-paper px-3.5 font-sans text-[15px] text-charcoal placeholder:text-mute/70 transition-colors duration-150 focus:border-forest/45 focus:outline-none focus:ring-2 focus:ring-forest/15 disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
});

export const PasswordField = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { revealDefault?: boolean }
>(function PasswordField({ className, revealDefault, ...props }, ref) {
  const [shown, setShown] = useState(!!revealDefault);
  const id = useId();
  return (
    <div className="relative">
      <input
        ref={ref}
        type={shown ? "text" : "password"}
        className={cn(
          "h-12 w-full rounded-[8px] border border-hairline bg-paper pl-3.5 pr-12 font-sans text-[15px] text-charcoal placeholder:text-mute/70 transition-colors duration-150 focus:border-forest/45 focus:outline-none focus:ring-2 focus:ring-forest/15 disabled:opacity-50",
          className,
        )}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        {...props}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={shown ? "Hide password" : "Show password"}
        onClick={() => setShown((v) => !v)}
        className="absolute right-0.5 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-[8px] text-mute transition-colors duration-150 hover:text-charcoal"
      >
        {shown ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
      </button>
      <span id={id} className="sr-only">
        password field
      </span>
    </div>
  );
});

/** Selectable mono text block with a copy affordance. */
export function MonoValue({
  value,
  onCopy,
  copyLabel = "Copy",
  className,
}: {
  value: string;
  onCopy?: () => void;
  copyLabel?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-[8px] border border-hairline bg-paper px-3.5 py-2.5",
        className,
      )}
    >
      <span className="t-fingerprint select-all text-charcoal">{value}</span>
      {onCopy ? (
        <button
          type="button"
          onClick={() => {
            onCopy();
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-[8px] px-2 font-sans text-[12.5px] font-medium text-mute transition-colors hover:text-charcoal"
        >
          {copied ? (
            <span className="text-forest">Copied</span>
          ) : (
            <>
              <span>{copyLabel}</span>
            </>
          )}
        </button>
      ) : null}
    </div>
  );
}
