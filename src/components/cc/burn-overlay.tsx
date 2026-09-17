// S6b — Room termination. The most beautiful two seconds in the app:
// paper darkens and chars from the edges inward, one line of Lora,
// then the desk, where the card wears its one-session ash. Somber,
// restrained, final.

"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/store/app";
import { InkMark } from "./mark";

export function BurnOverlay() {
  const burn = useApp((s) => s.burn);
  if (!burn) return null;
  return <BurnSequence key={`${burn.roomId}`} roomId={burn.roomId} />;
}

function BurnSequence({ roomId }: { roomId: string }) {
  const finishRoomBurn = useApp((s) => s.finishRoomBurn);
  const [phase, setPhase] = useState<"char" | "line" | "out">("char");

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("line"), 2000);
    const t2 = setTimeout(() => setPhase("out"), 3400);
    const t3 = setTimeout(() => finishRoomBurn(roomId), 3800);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [roomId, finishRoomBurn]);

  return (
    <div
      className="fixed inset-0 z-[80] overflow-hidden"
      style={{ animation: phase === "out" ? "burn-out 400ms cubic-bezier(0.2,0,0,1) forwards" : undefined }}
      role="alert"
      aria-live="assertive"
    >
      {/* char, closing inward — warm browns, ember at the rim */}
      <div
        className="absolute left-1/2 top-1/2 h-[340%] w-[340%]"
        style={{
          background:
            "radial-gradient(circle, transparent 0%, transparent 15%, rgba(200,90,64,0.10) 20%, rgba(48,30,20,0.6) 25%, #241610 29%, #150D08 36%)",
          transform: "translate(-50%, -50%) scale(3.4)",
          animation: "char-close 2000ms cubic-bezier(0.2,0,0,1) forwards",
        }}
        aria-hidden
      />
      {/* the page itself darkens, warm */}
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(180deg, rgba(26,16,10,0.6), rgba(14,9,6,0.66))",
          animation: "char-veil 2000ms cubic-bezier(0.2,0,0,1) forwards",
        }}
        aria-hidden
      />
      {/* ember breathing at the edges — terracotta heat, then ash */}
      <div
        className="absolute inset-0"
        style={{
          boxShadow:
            "inset 0 0 150px 48px rgba(232,168,124,0.42), inset 0 0 60px 18px rgba(200,90,64,0.28)",
          animation: "ember-rim 2300ms cubic-bezier(0.2,0,0,1) forwards",
        }}
        aria-hidden
      />
      {/* charred paper texture — the burn leaves grain behind */}
      <div
        className="absolute inset-0 mix-blend-multiply"
        style={{
          opacity: 0,
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='b'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.55' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23b)'/%3E%3C/svg%3E\")",
          backgroundSize: "180px 180px",
          animation: "char-grain 2000ms cubic-bezier(0.2,0,0,1) forwards",
        }}
        aria-hidden
      />
      {/* the line — and above it, the ink itself, lifted clean
          The halves part along the fracture while a few ember flecks
          rise and die: the room's last mark, breaking quietly. */}
      <div className="absolute inset-0 flex items-center justify-center px-8">
        <div className="flex flex-col items-center">
          <div
            style={{
              opacity: 0,
              animation:
                phase === "line" || phase === "out"
                  ? "burn-line-in 400ms cubic-bezier(0.2,0,0,1) forwards"
                  : undefined,
            }}
            aria-hidden
          >
            {/* cream, like the line below — the same literal the
                burn context already uses (the overlay is always its
                own dark, cinematic palette) */}
            <InkMark variant="scattered" size={84} ink="#EDE4D7" />
          </div>
          <p
            className="text-center font-serif text-[22px] font-semibold leading-[32px] tracking-[-0.005em]"
            style={{
              color: "#EDE4D7",
              textShadow: "0 0 24px rgba(232,168,124,0.28)",
              opacity: 0,
              animation:
                phase === "line" || phase === "out"
                  ? "burn-line-in 400ms cubic-bezier(0.2,0,0,1) forwards"
                  : undefined,
            }}
          >
            This room has been burned.
          </p>
        </div>
      </div>
    </div>
  );
}
