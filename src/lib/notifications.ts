// Notifications, in the app's voice. Two channels, one promise:
// nothing about a letter is revealed further than the user chose.
//
//   In-app:  while CipherChat is open and the user is elsewhere
//            (another room, the desk, the landing), a notice rises
//            at the top of the shell. It is IN FLOW: the app moves
//            down to make room; nothing is ever covered.
//   Native:  when the app is hidden (another tab, backgrounded,
//            installed-PWA), the service worker raises a system
//            notification. Tapping it returns to the room.
//
// What a notification says is a preference, not a guess:
//   "content": the letter's text, truncated
//   "sender":  only who wrote, and where (the default: the notice
//              says nothing until the user asks)
//   "none":    "A new letter arrived"
//
// The preference applies to BOTH channels. The OS notification
// shade is exactly where ephemerality is easiest to forget.

import { useNoticeStack } from "@/store/notices";

export type NotifyPreview = "content" | "sender" | "none";

export const NOTIFY_PREVIEW_DEFAULT: NotifyPreview = "sender";
const PREVIEW_KEY = "cc:notify:preview";
const PREVIEW_VALUES: NotifyPreview[] = ["content", "sender", "none"];

export function loadNotifyPreview(): NotifyPreview {
  try {
    const raw = localStorage.getItem(PREVIEW_KEY);
    return PREVIEW_VALUES.includes(raw as NotifyPreview)
      ? (raw as NotifyPreview)
      : NOTIFY_PREVIEW_DEFAULT;
  } catch {
    return NOTIFY_PREVIEW_DEFAULT;
  }
}

export function saveNotifyPreview(pref: NotifyPreview): void {
  try {
    localStorage.setItem(PREVIEW_KEY, pref);
  } catch {
    /* Private mode / storage wiped; the default still applies. */
  }
}

/* ------------------------------------------------------------------ */
/* The notice itself                                                   */
/* ------------------------------------------------------------------ */

export interface IncomingNotice {
  roomId: string;
  /** The room's local name on this device. */
  roomName: string;
  /** Sender alias, e.g. "Quiet Heron". */
  alias: string;
  /** Sender ink index (1..8); the banner carries their colour. */
  colorIdx: number;
  /** Decrypted preview text, if the channel may show it. */
  text?: string | null;
  isFile?: boolean;
}

const PREVIEW_MAX = 140;

function truncate(s: string, max = PREVIEW_MAX): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/** One line for the in-app banner (sender shown separately).
 *  A file is never quoted; the act is named, not the contents. */
export function bannerLine(n: IncomingNotice, pref: NotifyPreview): string {
  if (n.isFile) return pref === "none" ? "A file arrived" : "Sent a file";
  if (pref === "content" && n.text) return truncate(n.text);
  if (pref === "none") return "A new letter arrived";
  return "Sent a letter";
}

/** Title + body for the OS notification (sender not otherwise visible). */
export function describeNotice(
  n: IncomingNotice,
  pref: NotifyPreview,
): { title: string; body: string } {
  const where = n.roomName || "CipherChat";
  if (n.isFile) {
    return {
      title: where,
      body: pref === "none" ? "A file arrived" : `${n.alias} sent a file`,
    };
  }
  if (pref === "content" && n.text) {
    return { title: where, body: `${n.alias}: ${truncate(n.text)}` };
  }
  if (pref === "none") {
    return { title: where, body: "A new letter arrived" };
  }
  return { title: where, body: `${n.alias} sent a letter` };
}

/* ------------------------------------------------------------------ */
/* Where a notice goes: pure, so it can be tested without a browser */
/* ------------------------------------------------------------------ */

export type NoticeChannel = "none" | "banner" | "native";

export function decideNoticeChannel(opts: {
  hidden: boolean;
  inRoom: boolean;
}): NoticeChannel {
  if (opts.inRoom) return "none";
  if (opts.hidden) return "native";
  return "banner";
}

/* ------------------------------------------------------------------ */
/* Native plumbing: every entry point guarded; a notification is a   */
/* courtesy, never a crash.                                            */
/* ------------------------------------------------------------------ */

const NOTICE_ICON = "/icons/icon-192.png";

export type PermissionState = "granted" | "denied" | "default" | "unsupported";

export function notifyPermissionState(): PermissionState {
  try {
    if (typeof Notification === "undefined") return "unsupported";
    return Notification.permission;
  } catch {
    return "unsupported";
  }
}

export async function requestNotifyPermission(): Promise<PermissionState> {
  try {
    if (typeof Notification === "undefined") return "unsupported";
    await new Promise<void>((r) => {
      // Permission queries must run in a user gesture; a microtask
      // tick keeps iOS Safari happy about the promise chain.
      r();
    });
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

/**
 * Raise a system notification. Prefers the service worker (works on
 * Android Chrome and installed iOS PWAs, where the page-level
 * constructor is unavailable or forbidden); falls back to the page
 * constructor for desktop browsers without a worker (dev).
 */
export async function showNativeNotice(
  roomId: string,
  title: string,
  body: string,
  opts: { test?: boolean } = {},
): Promise<void> {
  const tag = opts.test ? "cc-test" : `cc-room-${roomId}`;
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (reg) {
      await reg.showNotification(title, {
        body,
        icon: NOTICE_ICON,
        badge: NOTICE_ICON,
        tag,
        data: opts.test ? {} : { roomId, url: `/#/r/${roomId}` },
      });
      return;
    }
  } catch {
    /* fall through to the page constructor */
  }
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      const n = new Notification(title, {
        body,
        icon: NOTICE_ICON,
        tag,
        data: opts.test ? {} : { roomId },
      });
      if (!opts.test) {
        n.onclick = () => {
          window.focus();
          window.dispatchEvent(
            new CustomEvent("cc:open-room", { detail: { roomId } }),
          );
          n.close();
        };
      }
    }
  } catch {
    /* Some browsers forbid the constructor outright (Android Chrome).
     * The unread dot on the room card is the quiet fallback. */
  }
}

/** The full decision; call from the receive path. */
export function notifyIncoming(n: IncomingNotice): void {
  const channel = decideNoticeChannel({
    hidden: typeof document !== "undefined" && document.hidden,
    inRoom: false,
  });
  if (channel === "banner") {
    useNoticeStack.getState().push(n);
  } else if (channel === "native" && notifyPermissionState() === "granted") {
    const { title, body } = describeNotice(n, loadNotifyPreview());
    void showNativeNotice(n.roomId, title, body);
  }
}

/* ------------------------------------------------------------------ */
/* The launcher badge: total unread letters, capped at 99             */
/* ------------------------------------------------------------------ */

export function clampBadgeCount(n: number): number {
  return Math.min(Math.max(n, 0), 99);
}

export function syncBadge(count: number): void {
  try {
    const nav = navigator as Navigator & {
      setAppBadge?: (n?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (count > 0) {
      void nav.setAppBadge?.(clampBadgeCount(count));
    } else {
      void nav.clearAppBadge?.();
    }
  } catch {
    /* Not supported; decoration only. */
  }
}
