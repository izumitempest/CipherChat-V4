"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

/* Hydrated? Server says no, client says yes — read through
 * useSyncExternalStore so no effect or setState is involved. */
const emptySubscribe = () => () => {};
function useHydrated() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

/** Nightfall toggle — the same desk, by lamplight. CSS decides which
 *  icon shows, so there is no hydration guesswork at all. The turn:
 *  after hydration, the icon pair is keyed by the resolved theme, so
 *  a switch remounts the span and the new icon swings in from a
 *  quarter-turn back (theme-turn in globals.css). */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const hydrated = useHydrated();
  const turnKey = hydrated ? (resolvedTheme ?? "system") : "boot";

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
      <span key={turnKey} className="theme-turn flex items-center justify-center">
        <Sun className="hidden size-[18px] dark:block" aria-hidden />
        <Moon className="size-[18px] dark:hidden" aria-hidden />
      </span>
    </button>
  );
}
