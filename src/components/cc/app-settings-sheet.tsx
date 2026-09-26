// App settings - the desk-level twin of room settings. What lives
// here belongs to the device, not to any room: how notifications
// speak (and whether they exist), and the app's seat on the home
// screen. Entry points: the bell on the desk header and the landing
// header.

"use client";

import { useState } from "react";
import { Bell, Check, ChevronRight, Flag, Plus, Share, Smartphone } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { PrimaryAction, SecondaryAction } from "@/components/cc/actions";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import { SheetGrabber } from "@/components/cc/sheet-grabber";
import { useLegalSheet } from "@/components/cc/legal-sheet";
import {
  loadNotifyPreview,
  notifyPermissionState,
  requestNotifyPermission,
  saveNotifyPreview,
  showNativeNotice,
  type NotifyPreview,
  type PermissionState,
} from "@/lib/notifications";
import { cn } from "@/lib/utils";

/* The bell that opens the sheet. */
export function AppSettingsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label="Notifications and app settings"
        title="Settings"
        onClick={() => setOpen(true)}
        className="flex size-11 items-center justify-center rounded-[12px] text-mute transition-colors duration-150 hover:bg-wash hover:text-charcoal"
      >
        <Bell className="size-[18px]" />
      </button>
      <AppSettingsSheet open={open} onOpenChange={setOpen} />
    </>
  );
}

const PREVIEW_OPTIONS: { value: NotifyPreview; label: string; hint: string }[] = [
  {
    value: "content",
    label: "Full text",
    hint: "The letter itself, in the banner and the system notification.",
  },
  {
    value: "sender",
    label: "Sender only",
    hint: "Who wrote, and in which room - never the words themselves.",
  },
  {
    value: "none",
    label: "Nothing",
    hint: "Only that a letter arrived. For the most careful desks.",
  },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-sans text-[13px] font-medium tracking-[0.01em] text-charcoal">
      {children}
    </p>
  );
}

function AboutRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-11 w-full items-center justify-between rounded-[8px] px-1 text-left font-sans text-[13.5px] text-charcoal transition-colors duration-150 hover:bg-wash"
    >
      {label}
      <ChevronRight className="size-4 text-mute" aria-hidden />
    </button>
  );
}

export function AppSettingsSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const isDesktop = useIsDesktop();
  const showLegal = useLegalSheet((s) => s.show);
  const install = useInstallPrompt();

  // Permission and preference, re-read every time the sheet opens.
  // Both can change elsewhere (OS settings, another tab).
  const [perm, setPerm] = useState<PermissionState>("default");
  const [pref, setPref] = useState<NotifyPreview>("sender");
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setPerm(notifyPermissionState());
      setPref(loadNotifyPreview());
    }
  }

  const [asking, setAsking] = useState(false);

  async function ask() {
    setAsking(true);
    const result = await requestNotifyPermission();
    setAsking(false);
    setPerm(result);
    if (result === "granted") {
      toast("Notifications are on", {
        description:
          "A hidden CipherChat will speak when letters arrive, saying only what you allow below.",
      });
    }
  }

  function sendTest() {
    void showNativeNotice("test", "CipherChat", "This is what a new letter sounds like.", {
      test: true,
    });
    toast("Test sent", {
      description:
        "If nothing appeared, notifications may be muted for this browser. The OS notification settings know why.",
    });
  }

  const previewHint = PREVIEW_OPTIONS.find((o) => o.value === pref)?.hint ?? "";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isDesktop ? "right" : "bottom"}
        className="flex flex-col overflow-y-auto overscroll-contain scroll-quiet rounded-t-[18px] border-hairline bg-paper px-5 pb-8 pt-5 md:max-w-[440px] md:rounded-t-none md:rounded-l-[18px]"
      >
        {!isDesktop && <SheetGrabber />}
        <SheetHeader className="p-0 text-left">
          <SheetTitle className="t-title">Settings</SheetTitle>
          <SheetDescription className="mt-1 font-sans text-[13px] leading-[19px] text-mute">
            These apply to CipherChat on this device, every room at once.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-5 space-y-6">
          {/* ---------------- Notifications ---------------- */}
          <div className="space-y-2.5">
            <SectionLabel>Notifications</SectionLabel>

            {perm === "default" || perm === "unsupported" ? (
              <div className="space-y-2.5">
                <p className="t-meta">
                  When CipherChat is hidden, a letter can still announce
                  itself, through your device, saying only what you allow.
                </p>
                {perm === "default" ? (
                  <PrimaryAction full busy={asking} onClick={() => void ask()}>
                    {asking ? "Asking your device" : "Allow notifications"}
                  </PrimaryAction>
                ) : (
                  <p className="t-meta">
                    This browser doesn&rsquo;t offer system notifications. While
                    CipherChat is open, in-app banners still rise for letters in
                    other rooms.
                  </p>
                )}
              </div>
            ) : perm === "denied" ? (
              <p className="t-meta">
                notifications are turned away for this browser. To welcome them
                back, allow notifications for CipherChat in your
                browser's site settings, then return here.
              </p>
            ) : (
              <div className="space-y-3">
                {/* Granted: what may a notification say. */}
                <div className="flex items-center gap-2" role="status">
                  <Check className="size-4 text-forest" strokeWidth={2.5} aria-hidden />
                  <p className="t-meta">
                    System notifications are on for this browser.
                  </p>
                </div>
                <div className="space-y-2">
                  <p className="font-sans text-[12.5px] text-mute">
                    What a notification may reveal
                  </p>
                  <div
                    role="radiogroup"
                    aria-label="Notification previews"
                    className="grid grid-cols-3 gap-1.5"
                  >
                    {PREVIEW_OPTIONS.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        role="radio"
                        aria-checked={pref === o.value}
                        onClick={() => {
                          setPref(o.value);
                          saveNotifyPreview(o.value);
                        }}
                        className={cn(
                          "flex h-11 items-center justify-center rounded-[10px] border font-sans text-[12.5px] transition-colors duration-150",
                          pref === o.value
                            ? "border-forest/40 bg-wash text-charcoal"
                            : "border-hairline bg-side text-mute hover:text-charcoal",
                        )}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                  <p className="t-meta" role="status">
                    {previewHint}
                  </p>
                </div>
                <SecondaryAction full onClick={sendTest}>
                  Send a test notification
                </SecondaryAction>
              </div>
            )}

            <p className="t-meta">
              While CipherChat is open, letters in rooms you&rsquo;re not
              reading rise as banners at the top. The app steps aside for
              them, nothing is covered.
            </p>
          </div>

          {/* ---------------- Install ---------------- */}
          <div className="space-y-2.5">
            <SectionLabel>On your home screen</SectionLabel>

            {install.standalone || install.installed ? (
              <div className="flex items-center gap-2" role="status">
                <Check className="size-4 text-forest" strokeWidth={2.5} aria-hidden />
                <p className="t-meta">
                  CipherChat is installed. It runs as its own app, no browser
                  chrome in sight.
                </p>
              </div>
            ) : install.canPrompt ? (
              <div className="space-y-2.5">
                <p className="t-meta">
                  Install CipherChat and it opens as its own window, launches
                  from your home screen, and keeps its shell ready offline.
                </p>
                <PrimaryAction
                  full
                  onClick={() =>
                    void install.promptInstall().then((accepted) => {
                      if (accepted) {
                        toast("Welcome to your home screen", {
                          description:
                            "CipherChat now lives beside your other apps. Same rooms, same vanishing ink.",
                        });
                      }
                    })
                  }
                >
                  Install app
                </PrimaryAction>
              </div>
            ) : install.isIos ? (
              <div className="space-y-2">
                <p className="t-meta">On iPhone and iPad, installing is three taps:</p>
                <ol className="space-y-1.5">
                  {[
                    { icon: Share, text: "Tap the Share button in Safari's toolbar" },
                    { icon: Plus, text: "Choose “Add to Home Screen”" },
                    { icon: Check, text: "Tap Add. CipherChat moves in beside your apps" },
                  ].map((step, i) => (
                    <li key={i} className="flex items-center gap-2.5 rounded-[8px] px-1 py-1">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-hairline bg-side text-mute">
                        <step.icon className="size-[15px]" aria-hidden />
                      </span>
                      <span className="font-sans text-[13px] leading-[18px] text-charcoal">
                        {step.text}
                      </span>
                    </li>
                  ))}
                </ol>
                <p className="t-meta">
                  The installed app opens full-screen with its own icon and
                  launch image.
                </p>
              </div>
            ) : (
              <div className="flex items-start gap-2.5">
                <Smartphone className="mt-0.5 size-4 shrink-0 text-mute" aria-hidden />
                <p className="t-meta">
                  On Android and desktop Chrome or Edge, your browser&rsquo;s
                  install option (in its menu) puts CipherChat on your home
                  screen or desktop.
                </p>
              </div>
            )}
          </div>

          {/* ---------------- About ---------------- */}
          <div className="space-y-2">
            <SectionLabel>About</SectionLabel>
            <div className="space-y-0.5">
              <AboutRow label="Terms of Use" onClick={() => showLegal("terms")} />
              <AboutRow label="Privacy Policy" onClick={() => showLegal("privacy")} />
            </div>
            <div className="flex items-start gap-2.5 px-1 pt-1">
              <Flag className="mt-0.5 size-4 shrink-0 text-mute" aria-hidden />
              <p className="t-meta">
                A room being misused can be reported from its settings:
                a member&rsquo;s report is signed with their room key and ends
                the room at once. A stranger's needs corroboration. For
                anything the room itself cannot fix,{" "}
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText("lilice308@gmail.com").then(
                      () => toast("Address copied"),
                      () => undefined,
                    );
                  }}
                  className="font-medium text-charcoal underline decoration-hairline underline-offset-2 hover:decoration-forest"
                >
                  lilice308@gmail.com
                </button>{" "}
                reaches the project author. Reporting cannot unsend anything,
                because nothing is kept.
              </p>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
