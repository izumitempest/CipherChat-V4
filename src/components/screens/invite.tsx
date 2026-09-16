// S2 — Invite link landing. A stranger arrives here from a shared
// link. Reassurance first, then the password, then Enter. No sign-up
// exists anywhere on this surface.

"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Field, PasswordField, TextField } from "@/components/cc/fields";
import { PrimaryAction, QuietAction } from "@/components/cc/actions";
import { SealMark } from "@/components/cc/mark";
import { parseRoomCode } from "@/lib/identity";
import { useApp, type JoinResult } from "@/store/app";
import { cn } from "@/lib/utils";

export function InviteScreen() {
  const inviteCode = useApp((s) => s.inviteCode);
  return <InviteForm prefilledCode={inviteCode} />;
}

function reasonCopy(reason: JoinResult["reason"]): string {
  switch (reason) {
    case "wrong-password":
      return "That password doesn't match this room.";
    case "not-found":
    case "burned":
      return "This room doesn't exist, or it has been burned.";
    case "room-full":
      return "This room is full.";
    default:
      return "Something went wrong entering the room. Try again.";
  }
}

function InviteForm({ prefilledCode }: { prefilledCode: string | null }) {
  const joinRoom = useApp((s) => s.joinRoom);
  const navigate = useApp((s) => s.navigate);

  const [code, setCode] = useState(prefilledCode ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState(false);

  const displayCode = prefilledCode
    ? `${prefilledCode.slice(0, 5)}-${prefilledCode.slice(5)}`
    : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const parsed = parseRoomCode(code);
    if (!parsed) {
      setError("Enter the room link or code you were given.");
      return;
    }
    if (!password.trim()) {
      setError("Enter the room password.");
      return;
    }
    setBusy(true);
    const res = await joinRoom(parsed, password.trim());
    setBusy(false);
    if (!res.ok) {
      setError(reasonCopy(res.reason));
      if (res.reason === "not-found" || res.reason === "burned") {
        // The card on the desk, if any, is ash now.
        useApp.setState((s) => ({ roomCards: s.roomCards.map((c) => (c.roomId === parsed ? { ...c, burned: true } : c)) }));
      }
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
        <QuietAction onClick={() => navigate("rooms")} aria-label="Back">
          <ChevronLeft className="size-4" aria-hidden /> Back
        </QuietAction>
        <span className="font-serif text-[18px] font-semibold tracking-[-0.01em]">
          CipherChat
        </span>
        <span className="size-11" aria-hidden />
      </header>

      <main className="mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center px-6 py-12">
        <SealMark size={48} className="opacity-90" />
        <h1 className="t-title mt-6 text-[22px] leading-[30px]">
          You&rsquo;ve been invited to a private, encrypted conversation.
        </h1>

        {displayCode ? (
          <p className="t-fingerprint mt-4 text-[13px] text-mute">
            Room {displayCode}
          </p>
        ) : null}

        <form onSubmit={submit} className="mt-7 space-y-4">
          {!prefilledCode ? (
            <Field label="Room link or code" htmlFor="cc-join-code">
              <TextField
                id="cc-join-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Paste the link, or type the code"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
          ) : null}
          <Field
            label="Room password"
            htmlFor="cc-join-pass"
            error={error}
          >
            <PasswordField
              id="cc-join-pass"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="given to you by the sender"
              autoFocus={!prefilledCode}
            />
          </Field>
          <PrimaryAction type="submit" full busy={busy}>
            {busy ? "Entering" : "Enter"}
          </PrimaryAction>
        </form>

        <div className="mt-8">
          <button
            type="button"
            onClick={() => setDetails((v) => !v)}
            aria-expanded={details}
            className="flex w-full items-center gap-1.5 rounded-[8px] py-2 font-sans text-[13px] font-medium text-mute transition-colors hover:text-charcoal"
          >
            <ChevronRight
              className={cn(
                "size-3.5 transition-transform duration-150",
                details && "rotate-90",
              )}
              aria-hidden
            />
            What happens next
          </button>
          <div className={cn("grid transition-all duration-200", details ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
            <div className="overflow-hidden">
              <ul className="space-y-2 pt-2 font-sans text-[12.5px] leading-[18px] text-mute">
                <li className="flex gap-2">
                  <span className="mt-[7px] size-1 shrink-0 rounded-full bg-mute" aria-hidden />
                  Messages are encrypted in your browser.
                </li>
                <li className="flex gap-2">
                  <span className="mt-[7px] size-1 shrink-0 rounded-full bg-mute" aria-hidden />
                  Nothing is stored. New joiners see no history.
                </li>
                <li className="flex gap-2">
                  <span className="mt-[7px] size-1 shrink-0 rounded-full bg-mute" aria-hidden />
                  The room&rsquo;s creator can burn it for everyone.
                </li>
              </ul>
            </div>
          </div>
        </div>
      </main>

      <footer className="pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-6">
        <p className="text-center font-sans text-[11.5px] text-mute">
          No account is created or needed.
        </p>
      </footer>
    </div>
  );
}
