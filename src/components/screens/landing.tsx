// S1 — Landing. One decision in five seconds: create, or join.
// No feature list, no marketing density. Below the fold, a single
// line of trust copy.

"use client";

import { useState } from "react";
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
import { SealMark } from "@/components/cc/mark";
import { ThemeToggle } from "@/components/cc/theme-toggle";
import { generatePassphrase } from "@/lib/identity";
import { useApp } from "@/store/app";

export function LandingScreen() {
  const navigate = useApp((s) => s.navigate);
  const hasRooms = useApp((s) => s.roomCards.length > 0);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
        <span className="font-serif text-[18px] font-semibold tracking-[-0.01em]">
          CipherChat
        </span>
        <ThemeToggle />
      </header>

      <main className="mx-auto flex w-full max-w-[440px] flex-1 flex-col items-center justify-center px-6 py-16 [@media(max-height:720px)]:py-9">
        <SealMark size={72} breathe />
        <h1 className="t-display mt-7 text-center">
          A conversation that leaves&nbsp;no&nbsp;trace.
        </h1>
        <div className="mt-9 flex w-full flex-col gap-3">
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
            className="mt-5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-forest/25"
            onClick={() => navigate("rooms")}
          >
            Back to your rooms
          </QuietAction>
        ) : null}
      </main>

      <footer className="mx-auto w-full max-w-[440px] px-6 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-8 [@media(max-height:720px)]:pt-5">
        <p className="text-center font-sans text-[11.5px] leading-[17px] text-mute">
          Messages are encrypted in your browser and destroyed on schedule.
          We can&rsquo;t read them. Neither can anyone else.
        </p>
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
  const [password, setPassword] = useState(() => generatePassphrase());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await createRoom(name.trim(), password.trim());
    setBusy(false);
    if (!res.ok) {
      setError("The room could not be created. Check your connection and try again.");
      return;
    }
    onOpenChange(false);
    toast("Room created", {
      description: "Share the link — and the password through a different channel.",
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-[18px] border-t border-hairline bg-paper px-5 pb-8 pt-5">
        <SheetHeader className="p-0 text-left">
          <SheetTitle className="t-title">Create a room</SheetTitle>
          <SheetDescription className="mt-1 font-sans text-[13px] leading-[19px] text-mute">
            Anyone with the room link and this password can enter. The
            password never leaves your browser.
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="mt-5 space-y-4">
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
                  onClick={() => setPassword(generatePassphrase())}
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
              id="cc-new-pass"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="room password"
              required
            />
          </Field>
          <PrimaryAction type="submit" full busy={busy}>
            {busy ? "Creating room" : "Create room"}
          </PrimaryAction>
        </form>
      </SheetContent>
    </Sheet>
  );
}
