// S1: landing. One decision in five seconds: create, or join.
// No feature list, no marketing density. Below the fold, a single
// line of trust copy.

"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Field, PasswordField, TextField } from "@/components/cc/fields";
import { PrimaryAction, SecondaryAction, QuietAction } from "@/components/cc/actions";
import { InkMark } from "@/components/cc/mark";
import { SheetGrabber } from "@/components/cc/sheet-grabber";
import { ThemeToggle } from "@/components/cc/theme-toggle";
import { AppSettingsButton } from "@/components/cc/app-settings-sheet";
import { LegalLinks } from "@/components/cc/legal-sheet";
import { RoomTtlPicker } from "@/components/cc/room-ttl-picker";
import { generatePassphrase } from "@/lib/identity";
import { ROOM_TTL_DEFAULT_SEC } from "@/lib/room-ttl";
import { useApp } from "@/store/app";

export function LandingScreen() {
  const navigate = useApp((s) => s.navigate);
  const hasRooms = useApp((s) => s.roomCards.length > 0);
  /* The porch's seal gesture ends here: the store consumed
   * ?create=1 during init (URL cleaned, flag raised), and the
   * landing answers by having the form already out. First render
   * happens after init (the ready gate), so the initial value is
   * simply the flag: no effect, no cascade. */
  const porchCreate = useApp((s) => s.porchCreate);
  const [createOpen, setCreateOpen] = useState(porchCreate);

  return (
    <div className="screen-in flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
        <span className="font-serif text-[18px] font-semibold tracking-[-0.01em]">
          CipherChat
        </span>
        <div className="flex items-center gap-1.5">
          <AppSettingsButton />
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[440px] flex-1 flex-col items-center justify-center px-6 py-16 [@media(max-height:720px)]:py-9">
        {/* Entrance: the ink falls. The drop releases from above
            with a lean, strikes the paper (~220ms: squash), and its
            flecks splash upward as the stain bleeds outward beneath
            it; a beat later the evaporating loop takes over. Hover
            the mark at rest: the flecks lift, the ember warms.
            Classes and staggers live in globals.css; the choreo
            needs multi-animation shorthands inline styles can't
            express. */}
        <div className="hero-mark relative">
          <span className="ink-halo" aria-hidden />
          <div className="drop-land">
            <InkMark size={72} breathe className="mark-land" />
          </div>
        </div>
        <h1
          className="t-display settle mt-7 text-center"
          style={{ animationDelay: "140ms" }}
        >
          A conversation that leaves&nbsp;no&nbsp;trace.
        </h1>
        <div
          className="mt-9 flex w-full flex-col gap-3 settle"
          style={{ animationDelay: "220ms" }}
        >
          <PrimaryAction
            full
            onClick={() => setCreateOpen(true)}
            className="focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-forest/40 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
          >
            Create a room
          </PrimaryAction>
          <SecondaryAction
            full
            onClick={() => navigate("invite")}
            className="focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-forest/40 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
          >
            Join with a link or code
          </SecondaryAction>
        </div>
        {hasRooms ? (
          <QuietAction
            className="mt-5 settle focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-forest/25"
            style={{ animationDelay: "300ms" }}
            onClick={() => navigate("rooms")}
          >
            Back to your rooms
          </QuietAction>
        ) : null}
      </main>

      <footer
        className="settle mx-auto w-full max-w-[440px] px-6 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-8 [@media(max-height:720px)]:pt-5"
        style={{ animationDelay: "320ms" }}
      >
        <p className="text-center font-sans text-[11.5px] leading-[17px] text-mute">
          Messages are encrypted in your browser and destroyed on schedule.
          We can&rsquo;t read them. Neither can anyone else.
        </p>
        <div className="mt-3 text-center font-sans text-[11.5px] leading-[17px]">
          <LegalLinks />
        </div>
      </footer>

      <CreateRoomSheet open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function CreateRoomSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const createRoom = useApp((s) => s.createRoom);
  const [name, setName] = useState("");
  const [ttl, setTtl] = useState<number>(ROOM_TTL_DEFAULT_SEC);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The passphrase is never React state. It is seeded straight into
  // the field's DOM property (never its attribute), read here only at
  // submit, and dies with the input node when the sheet unmounts.
  const passRef = useRef<HTMLInputElement>(null);

  // Fresh CSPRNG phrase each time the sheet opens.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName("");
      setTtl(ROOM_TTL_DEFAULT_SEC);
      setError(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const password = passRef.current?.value ?? "";
    if (!password.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await createRoom(name.trim(), password.trim(), ttl);
    setBusy(false);
    if (!res.ok) {
      setError("The room could not be created. Check your connection and try again.");
      return;
    }
    // Created: the plaintext's job is done; wipe it, then close (the
    // unmount would take it anyway; this is the belt to that braces).
    if (passRef.current) passRef.current.value = "";
    onOpenChange(false);
    toast("Room created", {
      description: "Share the link — and the password through a different channel.",
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="overflow-y-auto overscroll-contain scroll-quiet rounded-t-[18px] border-t border-hairline bg-paper px-5 pb-8 pt-5">
        <SheetGrabber />
        <SheetHeader className="p-0 text-left">
          <SheetTitle className="t-title">Create a room</SheetTitle>
          <SheetDescription className="mt-1 font-sans text-[13px] leading-[19px] text-mute">
            Anyone with the room link and this password can enter. The
            password never leaves your browser.
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="mt-5 space-y-4">
          {/* Seeds the secret field the moment the sheet body mounts.
              This must live INSIDE the portal content: Radix mounts
              portal children in a later commit than the parent's
              open-state change, so a parent effect can fire before
              the input exists. As part of the content, this runs
              exactly when the field it seeds comes to life, and
              again on every reopen, since closing unmounts the
              content. Property assignment only: the value attribute
              stays absent for the field's whole life. */}
          <SeedPassphrase passRef={passRef} />
          <Field label="Room name (only you see this)" htmlFor="cc-new-name">
            <TextField
              id="cc-new-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Trip plans"
              maxLength={60}
            />
          </Field>
          <Field
            label="Room password"
            htmlFor="cc-new-pass"
            hint={
              <span className="inline-flex items-center gap-1.5">
                <button
                  type="button"
                  className="font-medium text-forest underline decoration-forest/30 underline-offset-2 hover:decoration-forest"
                  onClick={() => {
                    if (passRef.current)
                      passRef.current.value = generatePassphrase();
                  }}
                >
                  New password
                  <RefreshCw className="ml-1 inline size-3 align-[-1px]" />
                </button>
                — share it through a different channel than the link.
              </span>
            }
            error={error}
          >
            <PasswordField
              ref={passRef}
              id="cc-new-pass"
              placeholder="room password"
              required
            />
          </Field>

          {/* The room's clock, chosen once here, adjustable later
              by the creator alone. */}
          <div className="space-y-2">
            <p className="font-sans text-[13px] font-medium tracking-[0.01em] text-charcoal">
              Room lifetime
            </p>
            <RoomTtlPicker value={ttl} onChange={setTtl} />
          </div>

          <PrimaryAction type="submit" full busy={busy}>
            {busy ? "Creating room" : "Create room"}
          </PrimaryAction>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/* Mounts (and remounts) with the sheet content, seeding the secret
 * field's DOM property with a fresh CSPRNG passphrase. Rendering null,
 * it costs nothing; it exists purely so the seeding effect runs at
 * the exact moment its target input comes to life. */
function SeedPassphrase({
  passRef,
}: {
  passRef: React.RefObject<HTMLInputElement | null>;
}) {
  useEffect(() => {
    if (passRef.current) passRef.current.value = generatePassphrase();
  }, [passRef]);
  return null;
}
