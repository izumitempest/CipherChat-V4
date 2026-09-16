// The CipherChat seal — a wax impression, not a logo. It breathes
// on the landing screen (the app's single intentional idle loop).

import { cn } from "@/lib/utils";

export function SealMark({
  size = 64,
  breathe = false,
  className,
}: {
  size?: number;
  breathe?: boolean;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      fill="none"
      aria-hidden="true"
      className={cn(breathe && "mark-breathe", className)}
    >
      <circle
        cx="48"
        cy="48"
        r="34"
        stroke="var(--forest)"
        strokeWidth="5"
      />
      <circle
        cx="48"
        cy="48"
        r="27"
        stroke="var(--forest)"
        strokeWidth="1.5"
        opacity="0.45"
      />
      <circle cx="48" cy="48" r="12" fill="var(--forest)" />
    </svg>
  );
}
