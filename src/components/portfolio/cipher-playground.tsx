"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Flame, Lock, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InkMark } from "@/components/cc/mark";
import { Section } from "./section";
import { cn } from "@/lib/utils";

/* ============================================================
   A live example: a real WebCrypto pipeline in the page:
   PBKDF2-SHA256 (310k) → AES-256-GCM, plaintext padded to a
   fixed 128-byte block so the frame is ALWAYS 156 B
   (12 IV + 128 payload + 16 tag), the product's uniformity
   property, demonstrated rather than described. Nothing leaves
   this page.
   ============================================================ */

const PAD = 128;
const FRAME_BYTES = 12 + PAD + 16; // iv + payload + gcm tag
const ITERATIONS = 310_000;

/* The flecks a burned message leaves: deterministic vectors so
 * server and client paint the same page. Ember is motion-only,
 * exactly as the design law says. */
const BURN_FLECKS = [
  { left: "12%", dx: "-22px", rot: "-35deg", delay: "0ms", size: 10, ember: false },
  { left: "22%", dx: "16px", rot: "25deg", delay: "60ms", size: 7, ember: true },
  { left: "31%", dx: "-10px", rot: "50deg", delay: "20ms", size: 8, ember: false },
  { left: "42%", dx: "24px", rot: "-20deg", delay: "90ms", size: 11, ember: false },
  { left: "53%", dx: "-18px", rot: "15deg", delay: "40ms", size: 7, ember: true },
  { left: "61%", dx: "12px", rot: "-45deg", delay: "0ms", size: 9, ember: false },
  { left: "70%", dx: "-26px", rot: "30deg", delay: "75ms", size: 8, ember: false },
  { left: "78%", dx: "20px", rot: "-15deg", delay: "35ms", size: 10, ember: true },
  { left: "86%", dx: "-14px", rot: "40deg", delay: "55ms", size: 7, ember: false },
  { left: "94%", dx: "18px", rot: "-30deg", delay: "15ms", size: 9, ember: false },
] as const;

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function deriveKey(
  pw: string,
  salt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey(
    "raw",
    enc.encode(pw),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
}

async function sealFrame(
  key: CryptoKey,
  text: string,
): Promise<{ b64: string; nonceHex: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const raw = new TextEncoder().encode(text);
  const plain = new Uint8Array(PAD);
  plain.set(raw.subarray(0, Math.min(raw.length, PAD)));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain),
  );
  const frame = new Uint8Array(iv.length + ct.length);
  frame.set(iv);
  frame.set(ct, iv.length);
  return { b64: toB64(frame), nonceHex: toHex(iv).slice(0, 12) };
}

/* The small labels: Inter, sentence case, the way the product
 * labels its own fields. */
const labelClass =
  "font-sans text-[12.5px] font-medium tracking-[0.01em] text-charcoal";
const noteClass = "font-sans text-[12px] leading-[1.6] text-mute";

function BurnField({ label }: { label: string }) {
  return (
    <div className="relative flex min-h-[132px] flex-1 flex-col items-center justify-center gap-4 py-6">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        {BURN_FLECKS.map((f, i) => (
          <span
            key={i}
            className="ash-flee absolute bottom-8"
            style={
              {
                left: f.left,
                "--flee-dx": f.dx,
                "--flee-rot": f.rot,
                animationDelay: f.delay,
              } as React.CSSProperties
            }
          >
            <InkMark
              size={f.size}
              variant="fleck"
              className={f.ember ? "text-ember" : "text-ash"}
            />
          </span>
        ))}
      </div>
      <InkMark size={30} variant="scattered" className="text-ash/70" />
      <p className="relative font-sans text-[13px] text-mute">{label}</p>
    </div>
  );
}

export function CipherPlayground() {
  const [password, setPassword] = useState("correct horse battery staple");
  const [message, setMessage] = useState("meet at the bridge at 9. tell no one");
  const [saltB64, setSaltB64] = useState<string | null>(null);
  const [saltBytes, setSaltBytes] = useState<Uint8Array<ArrayBuffer> | null>(
    null,
  );
  const [sealed, setSealed] = useState<{
    b64: string;
    nonceHex: string;
  } | null>(null);
  const [frameNo, setFrameNo] = useState(0);
  const [busy, setBusy] = useState(false);
  const [burning, setBurning] = useState(false);
  const [reseed, setReseed] = useState(0);
  const keyCache = useRef<{ pw: string; salt: string; key: CryptoKey } | null>(
    null,
  );

  // A fresh salt on arrival: the demo never reuses one.
  useEffect(() => {
    const b = crypto.getRandomValues(new Uint8Array(16));
    setSaltBytes(b);
    setSaltB64(toB64(b));
  }, []);

  // The encryption itself: debounced so typing feels like the app.
  // Every keystroke re-encrypts under a fresh nonce, and the
  // ciphertext you watch re-roll is the property, not a refresh.
  useEffect(() => {
    if (saltBytes === null || burning) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setBusy(true);
      (async () => {
        try {
          const pw = password || "";
          const saltKey = toB64(saltBytes);
          let cached = keyCache.current;
          if (!cached || cached.pw !== pw || cached.salt !== saltKey) {
            cached = {
              pw,
              salt: saltKey,
              key: await deriveKey(pw, saltBytes),
            };
            keyCache.current = cached;
          }
          const result = await sealFrame(cached.key, message);
          if (cancelled) return;
          setSealed(result);
          setFrameNo((n) => n + 1);
        } finally {
          if (!cancelled) setBusy(false);
        }
      })();
    }, 130);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [password, message, saltBytes, burning, reseed]);

  const regenerateSalt = useCallback(() => {
    keyCache.current = null;
    const b = crypto.getRandomValues(new Uint8Array(16));
    setSaltBytes(b);
    setSaltB64(toB64(b));
  }, []);

  const rawLen = useMemo(
    () => new TextEncoder().encode(message).length,
    [message],
  );
  const clipped = rawLen > PAD;

  return (
    <Section
      id="demo"
      title="A live example"
      lede="This example runs in your browser with the same WebCrypto API the app uses. Nothing is sent to a server. Type on the left. The right side shows the frame the server would receive."
    >
      <div className="rounded-[12px] border border-hairline">
        {/* the door: password + salt */}
        <div className="border-b border-hairline p-4 sm:p-5">
          <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto]">
            <label className="block">
              <span className={`${labelClass} flex items-center gap-1.5`}>
                <Lock aria-hidden className="size-3 text-forest" />
                Password
              </span>
              <Input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                maxLength={64}
                spellCheck={false}
                autoComplete="off"
                className="mt-2 h-10 rounded-[8px] border-hairline bg-paper font-mono text-[12.5px] focus-visible:ring-forest/40"
                aria-describedby="playground-kdf-note"
              />
            </label>
            <div className="flex items-center gap-2">
              <span className="flex h-10 items-center gap-2 rounded-[8px] border border-hairline bg-paper px-3 font-mono text-[11px] text-mute">
                salt&nbsp;
                <span className="text-charcoal/80">
                  {saltB64 ? `${saltB64.slice(0, 10)}…` : "…"}
                </span>
              </span>
              <Button
                type="button"
                variant="secondary"
                onClick={regenerateSalt}
                className="h-10 rounded-[8px] px-3 hover:bg-wash"
                aria-label="Regenerate the salt"
              >
                <RefreshCw aria-hidden className="size-4" />
              </Button>
            </div>
          </div>
          <p id="playground-kdf-note" className={`mt-3 ${noteClass}`}>
            The app derives its key with argon2id, which costs 64 MB of
            memory and takes about a second. This example uses PBKDF2-SHA256
            with {ITERATIONS.toLocaleString()} rounds instead, so it can run
            as you type. The encryption is the same.
          </p>
        </div>

        {/* the two panes */}
        <div className="grid md:grid-cols-2">
          {/* what you see */}
          <div className="flex flex-col border-b border-hairline p-5 md:border-b-0 md:border-r">
            <p className={labelClass}>What you see</p>
            {burning ? (
              <BurnField label="Nothing left to hand over. The words are gone." />
            ) : (
              <div className="mt-4">
                <div
                  className={cn(
                    "min-h-14 border-l-2 border-forest/40 pl-4 font-serif text-[16px] leading-[1.6] transition-opacity duration-200",
                    busy && "opacity-70",
                  )}
                >
                  {message.trim() ? (
                    message
                  ) : (
                    <span className="text-mute/70">
                      (nothing typed; it still encrypts to {FRAME_BYTES} B)
                    </span>
                  )}
                </div>
              </div>
            )}
            <p className={`mt-auto pt-4 ${noteClass}`}>
              The plaintext, encrypted in this tab with a key the server
              never receives.
            </p>
          </div>

          {/* what the server sees */}
          <div className="flex min-h-[260px] flex-col rounded-b-none bg-[#1d1e21] p-5 md:rounded-br-[12px] dark:bg-[#0f1013]">
            <p className="font-sans text-[12.5px] font-medium tracking-[0.01em] text-ember/80">
              What the server sees
            </p>
            {burning ? (
              <BurnField label="The server holds nothing at all." />
            ) : (
              <div className="mt-4 flex-1">
                <p
                  className={cn(
                    "cipher-fade max-h-[176px] overflow-hidden break-all font-mono text-[11.5px] leading-[1.85] text-ash transition-opacity duration-200 dark:text-[#8f8a80]",
                    busy && "opacity-60",
                  )}
                >
                  {sealed ? sealed.b64 : "deriving key…"}
                </p>
              </div>
            )}
            <p className="mt-4 font-mono text-[10.5px] tabular-nums tracking-[0.04em] text-ash/70">
              {burning
                ? "frame … · … B"
                : `frame ${String(frameNo).padStart(4, "0")} · nonce ${
                    sealed ? sealed.nonceHex : "…"
                  } · ${FRAME_BYTES} B`}
            </p>
          </div>
        </div>

        {/* the composer */}
        <div className="border-t border-hairline p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="flex-1">
              <span className="sr-only">Message to encrypt</span>
              <Input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={96}
                placeholder="type something…"
                disabled={burning}
                className="h-10 rounded-[8px] border-hairline bg-paper font-mono text-[13px] focus-visible:ring-forest/40"
              />
            </label>
            {burning ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setBurning(false);
                  setReseed((n) => n + 1);
                }}
                className="h-10 shrink-0 rounded-[8px] px-5 font-sans text-[13.5px] font-medium hover:bg-wash"
              >
                <RotateCcw aria-hidden className="size-4" />
                Start over
              </Button>
            ) : (
              <div className="flex shrink-0 gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setReseed((n) => n + 1)}
                  className="h-10 rounded-[8px] px-4 font-sans text-[13.5px] font-medium hover:bg-wash"
                  aria-label="Encrypt again with a fresh nonce"
                >
                  <RefreshCw aria-hidden className="size-4" />
                  Encrypt again
                </Button>
                <Button
                  type="button"
                  onClick={() => setBurning(true)}
                  className="h-10 rounded-[8px] bg-terracotta px-5 font-sans text-[13.5px] font-medium tracking-[0.01em] hover:bg-terracotta-deep"
                >
                  <Flame aria-hidden className="size-4" />
                  Burn
                </Button>
              </div>
            )}
          </div>
          <p
            className={cn(
              "mt-3 font-mono text-[10.5px] tabular-nums tracking-[0.04em]",
              clipped ? "text-terracotta" : "text-mute",
            )}
          >
            plaintext {rawLen} B → padded {PAD} B → encrypted {FRAME_BYTES} B
            {clipped
              ? ". Clipped to the frame; the app would send it in same-size chunks."
              : ". The frame size never changes."}
          </p>
        </div>
      </div>

      <p className="mt-5 max-w-[72ch] font-sans text-[13.5px] leading-[1.7] text-mute">
        In the app, the payload is signed, padded, and encrypted with
        AES-256-GCM. The entry key comes from argon2id. Two things to check in
        this example: the frame size never changes, and the server pane never
        shows the plaintext.
      </p>
    </Section>
  );
}
