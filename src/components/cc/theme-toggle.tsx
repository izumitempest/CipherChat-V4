"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

/** Nightfall toggle — the same desk, by lamplight. CSS decides which
 *  icon shows, so there is no hydration guesswork at all. */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <button
      type="button"
      aria-label="Switch between daylight and nightfall"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className={
        "flex size-11 items-center justify-center rounded-[12px] text-mute transition-colors duration-150 hover:bg-wash hover:text-charcoal " +
        (className ?? "")
      }
    >
      <Sun className="hidden size-[18px] dark:block" aria-hidden />
      <Moon className="size-[18px] dark:hidden" aria-hidden />
    </button>
  );
}
