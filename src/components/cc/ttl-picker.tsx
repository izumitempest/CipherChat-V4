// The lifetime picker — presets in the machine's voice (Off, 15s,
// 30s, 1m…) and, when a letter needs a fate the presets don't
// cover, a custom row: a number, a unit, a clamp. One component,
// seated wherever lifetimes are chosen — the composer's hourglass
// and the room's default.

"use client";

import { useState } from "react";
import { Check, Hourglass } from "lucide-react";
import { TTL_STEPS, clampTtl, isCustomTtl, TTL_MIN_SEC, TTL_MAX_SEC } from "@/lib/types";
import { fmtTtlLong, fmtTtlShort } from "@/lib/format";
import { cn } from "@/lib/utils";

const UNITS = [
  { key: "s", label: "sec", mult: 1 },
  { key: "m", label: "min", mult: 60 },
  { key: "h", label: "hr", mult: 3600 },
] as const;

type UnitKey = (typeof UNITS)[number]["key"];

function seedUnit(sec: number): UnitKey {
  if (sec >= 3600 && sec % 3600 === 0) return "h";
  if (sec >= 60 && sec % 60 === 0) return "m";
  return "s";
}

export function TtlPicker({
  value,
  onChange,
  onFirstArm,
}: {
  /** Current lifetime in seconds (0 = off). */
  value: number;
  onChange: (v: number) => void;
  /** Fired the first time a non-zero lifetime is chosen in this
   *  picker's lifetime (caller decides what "first" means). */
  onFirstArm?: () => void;
}) {
  const custom = isCustomTtl(value);
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState<UnitKey>("s");

  function openEditor() {
    // Seed from the current value when it's already custom; other-
    // wise from a sensible 30 seconds. The user adjusts from there.
    const seed = custom ? value : 30;
    const u = seedUnit(seed);
    setUnit(u);
    setAmount(String(Math.max(1, Math.round(seed / (u === "h" ? 3600 : u === "m" ? 60 : 1)))));
    setEditing(true);
  }

  function commitCustom() {
    const n = parseInt(amount, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    const mult = UNITS.find((u) => u.key === unit)?.mult ?? 1;
    const clamped = clampTtl(n * mult);
    onChange(clamped);
    setEditing(false);
    if (onFirstArm) onFirstArm();
  }

  const draftSec = (() => {
    const n = parseInt(amount, 10);
    if (!Number.isFinite(n) || n <= 0) return 0;
    const mult = UNITS.find((u) => u.key === unit)?.mult ?? 1;
    return n * mult;
  })();
  const draftClamped = draftSec > TTL_MAX_SEC;

  return (
    <div role="radiogroup" aria-label="Message lifetime" className="space-y-1.5">
      <div className="grid grid-cols-4 gap-1.5">
        {TTL_STEPS.map((step) => {
          const selected = !editing && !custom && value === step.value;
          return (
            <button
              key={step.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                onChange(step.value);
                setEditing(false);
                if (step.value !== 0 && onFirstArm) onFirstArm();
              }}
              className={cn(
                "h-11 rounded-[8px] border font-sans text-[12.5px] font-medium transition-colors duration-150",
                selected
                  ? "border-forest bg-forest text-paper"
                  : "border-hairline bg-side text-mute hover:border-forest/25 hover:bg-wash hover:text-charcoal",
              )}
            >
              {step.short}
            </button>
          );
        })}
        <button
          type="button"
          role="radio"
          aria-checked={custom}
          onClick={() => {
            if (custom && !editing) {
              // already custom — let them adjust it
              openEditor();
            } else if (!custom) {
              openEditor();
            } else {
              setEditing(false);
            }
          }}
          className={cn(
            "flex h-11 items-center justify-center gap-1 rounded-[8px] border font-sans text-[12.5px] font-medium transition-colors duration-150",
            custom && !editing
              ? "border-forest bg-forest text-paper"
              : editing
                ? "border-forest/45 bg-wash text-forest"
                : "border-hairline bg-side text-mute hover:border-forest/25 hover:bg-wash hover:text-charcoal",
          )}
        >
          {custom && !editing ? fmtTtlShort(value) : "Custom"}
        </button>
      </div>

      {editing ? (
        <div className="settle rounded-[10px] border border-hairline bg-side p-2.5">
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="cc-ttl-amount">
              Custom lifetime amount
            </label>
            <input
              id="cc-ttl-amount"
              type="number"
              inputMode="numeric"
              min={1}
              max={999}
              value={amount}
              autoFocus
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitCustom();
                }
              }}
              className="h-10 w-[76px] rounded-[8px] border border-hairline bg-paper px-2.5 text-center font-sans text-[14px] font-medium text-charcoal tabular-nums focus:border-forest/45 focus:outline-none focus:ring-2 focus:ring-forest/15"
            />
            <div
              role="radiogroup"
              aria-label="Unit"
              className="flex h-10 items-center gap-0.5 rounded-[8px] border border-hairline bg-paper p-0.5"
            >
              {UNITS.map((u) => (
                <button
                  key={u.key}
                  type="button"
                  role="radio"
                  aria-checked={unit === u.key}
                  aria-label={u.label}
                  onClick={() => setUnit(u.key)}
                  className={cn(
                    "h-9 rounded-[6px] px-2.5 font-sans text-[12px] font-medium transition-colors duration-150",
                    unit === u.key
                      ? "bg-forest text-paper"
                      : "text-mute hover:bg-wash hover:text-charcoal",
                  )}
                >
                  {u.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={commitCustom}
              disabled={draftSec <= 0}
              className="ml-auto flex h-10 items-center gap-1.5 rounded-[8px] bg-forest px-3 font-sans text-[12.5px] font-medium text-paper transition duration-150 hover:bg-forest-deep active:translate-y-px disabled:pointer-events-none disabled:opacity-50"
            >
              <Check className="size-3.5" aria-hidden />
              Set
            </button>
          </div>
          <p className="t-meta mt-2 flex items-center gap-1.5">
            <Hourglass className="size-3 shrink-0" aria-hidden />
            {draftSec > 0
              ? draftClamped
                ? `Capped at ${fmtTtlLong(TTL_MAX_SEC)} — the longest a letter may wait.`
                : `Letters destroy themselves after ${fmtTtlLong(clampTtl(draftSec))}.`
              : `Between ${TTL_MIN_SEC} seconds and ${fmtTtlLong(TTL_MAX_SEC)}.`}
          </p>
        </div>
      ) : (
        <p className="t-meta flex items-center gap-1.5">
          <Hourglass className="size-3 shrink-0" aria-hidden />
          {value === 0
            ? "New letters stay until the room closes."
            : `New letters destroy themselves after ${fmtTtlLong(value)}.`}
        </p>
      )}
    </div>
  );
}
