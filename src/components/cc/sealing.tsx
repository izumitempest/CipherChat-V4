// S3 — the key derivation moment. A vault door, not a loading bar:
// a full-surface state with a slow, physical progress indicator while
// a deliberately slow derivation runs. This is where the user decides
// the encryption is real.

"use client";

import { useApp } from "@/store/app";
import { InkMark } from "./mark";

const R = 34;
const C = 2 * Math.PI * R; // ~213.6

export function SealingOverlay() {
  const sealing = useApp((s) => s.sealing);
  if (!sealing) return null;
  return <Sealing label={sealing.label} />;
}

export function Sealing({
  label = "Sealing the room",
  sub = "Deriving your encryption keys. This takes a moment on purpose.",
}: {
  label?: string;
  sub?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-paper px-8"
    >
      <div className="relative seal-press" style={{ width: 96, height: 96 }}>
        <svg width="96" height="96" viewBox="0 0 96 96" className="-rotate-90">
          {/* track */}
          <circle
            cx="48"
            cy="48"
            r={R}
            fill="none"
            stroke="var(--hairline)"
            strokeWidth="3"
          />
          {/* the press — fills with weight */}
          <circle
            cx="48"
            cy="48"
            r={R}
            fill="none"
            stroke="var(--forest)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={C}
            className="seal-arc"
            style={
              {
                "--seal-circumference": C,
                animationName: "seal-arc",
                animationDuration: "1700ms",
                animationTimingFunction: "cubic-bezier(0.2, 0, 0, 1)",
                animationFillMode: "both",
              } as React.CSSProperties
            }
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <InkMark size={30} />
        </div>
      </div>
      {/* Three wax shards — tiny fragments of the seal, still
          settling in the whisper cadence while the derivation does
          its real, deliberately slow work. */}
      <div className="mt-6 flex items-center justify-center gap-2" aria-hidden>
        <InkMark variant="fleck" size={9} className="typing-dot text-forest/45" />
        <InkMark
          variant="fleck"
          size={9}
          className="typing-dot text-forest/70"
          style={{ animationDelay: "180ms" }}
        />
        <InkMark
          variant="fleck"
          size={9}
          className="typing-dot text-forest"
          style={{ animationDelay: "360ms" }}
        />
      </div>
      <p className="t-title mt-4 text-center">{label}</p>
      <p className="mt-2 max-w-[280px] text-center font-sans text-[13px] leading-[19px] text-mute">
        {sub}
      </p>
    </div>
  );
}
