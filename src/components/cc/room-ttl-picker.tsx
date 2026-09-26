// The room lifetime picker: the creator's clock. Presets in days
// and hours, "Until burned" for those who mean it, and a custom row
// (minutes / hours / days, clamped to the sanctioned range) for
// everything in between. Seated at creation and, for the creator,
// in room settings.

"use client";

import { useState } from "react";
import { Check, Flame } from "lucide-react";
import {
  ROOM_TTL_PRESETS,
  ROOM_TTL_MIN_SEC,
  ROOM_TTL_MAX_SEC,
  clampRoomTtl,
  isCustomRoomTtl,
  fmtRoomTtlLong,
  fmtRoomTtlShort,
} from "@/lib/room-ttl";
import { cn } from "@/lib/utils";

const UNITS = [
  { key: "m", label: "min", mult: 60 },
  { key: "h", label: "hr", mult: 3600 },
  { key: "d", label: "day", mult: 86400 },
] as const;

type UnitKey = (typeof UNITS)[number]["key"];

function seedUnit(sec: number): UnitKey {
  if (sec >= 86400 && sec % 86400 === 0) return "d";
  if (sec >= 3600 && sec % 3600 === 0) return "h";
  return "m";
}

export function RoomTtlPicker({
  value,
  onChange,
}: {
  /** Current lifetime in seconds (0 = until burned). */
  value: number;
  onChange: (v: number) => void;
}) {
  const custom = isCustomRoomTtl(value);
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState<UnitKey>("h");

  function openEditor() {
    const seed = custom ? value : 7200; // 2 hours is a fine starting point
    const u = seedUnit(seed);
    setUnit(u);
    setAmount(String(Math.max(1, Math.round(seed / (u === "d" ? 86400 : u === "h" ? 3600 : 60)))));
    setEditing(true);
  }

  function commitCustom() {
    const n = parseInt(amount, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    const mult = UNITS.find((u) => u.key === unit)?.mult ?? 1;
    onChange(clampRoomTtl(n * mult));
    setEditing(false);
  }

  const draftSec = (() => {
    const n = parseInt(amount, 10);
    if (!Number.isFinite(n) || n <= 0) return 0;
    const mult = UNITS.find((u) => u.key === unit)?.mult ?? 1;
    return n * mult;
  })();
  const draftClamped =
    draftSec > ROOM_TTL_MAX_SEC || (draftSec > 0 && draftSec < ROOM_TTL_MIN_SEC);

  return (
    <div className="space-y-1.5">
      <div role="radiogroup" aria-label="Room lifetime" className="grid grid-cols-3 gap-1.5">
        {ROOM_TTL_PRESETS.map((p) => {
          const selected = !editing && !custom && value === p.value;
          return (
            <button
              key={p.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                onChange(p.value);
                setEditing(false);
              }}
              className={cn(
                "h-11 rounded-[8px] border font-sans text-[12.5px] font-medium transition-colors duration-150",
                selected
                  ? "border-forest bg-forest text-paper"
                  : "border-hairline bg-side text-mute hover:border-forest/25 hover:bg-wash hover:text-charcoal",
              )}
            >
              {p.short}
            </button>
          );
        })}
        <button
          type="button"
          role="radio"
          aria-checked={custom}
          onClick={() => {
            if (!editing) openEditor();
          }}
          className={cn(
            "flex h-11 items-center justify-center rounded-[8px] border font-sans text-[12.5px] font-medium transition-colors duration-150",
            custom && !editing
              ? "border-forest bg-forest text-paper"
              : editing
                ? "border-forest/45 bg-wash text-forest"
                : "border-hairline bg-side text-mute hover:border-forest/25 hover:bg-wash hover:text-charcoal",
          )}
        >
          {custom && !editing ? fmtRoomTtlShort(value) : "Custom"}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={value === 0}
          onClick={() => {
            onChange(0);
            setEditing(false);
          }}
          className={cn(
            "col-span-3 flex h-11 items-center justify-center gap-1.5 rounded-[8px] border font-sans text-[12.5px] font-medium transition-colors duration-150",
            value === 0
              ? "border-terracotta/55 bg-terracotta/10 text-terracotta"
              : "border-hairline bg-side text-mute hover:border-terracotta/35 hover:text-terracotta",
          )}
        >
          <Flame className="size-3.5" aria-hidden />
          Until burned
          <span className="font-normal text-mute">- no clock, only the match</span>
        </button>
      </div>

      {editing ? (
        <div className="settle rounded-[10px] border border-hairline bg-side p-2.5">
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="cc-room-ttl-amount">
              Custom room lifetime amount
            </label>
            <input
              id="cc-room-ttl-amount"
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
          <p className="t-meta mt-2">
            {draftSec > 0
              ? draftClamped
                ? `Capped into ${fmtRoomTtlLong(clampRoomTtl(draftSec))}. Rooms live between 5 minutes and 30 days.`
                : `The room closes after ${fmtRoomTtlLong(clampRoomTtl(draftSec))}.`
              : `Between 5 minutes and 30 days.`}
          </p>
        </div>
      ) : (
        <p className="t-meta">
          {value === 0
            ? "The room exists until you burn it, or the server does."
            : `The room closes after ${fmtRoomTtlLong(value)}. Everyone is shown the clock.`}
        </p>
      )}
    </div>
  );
}
