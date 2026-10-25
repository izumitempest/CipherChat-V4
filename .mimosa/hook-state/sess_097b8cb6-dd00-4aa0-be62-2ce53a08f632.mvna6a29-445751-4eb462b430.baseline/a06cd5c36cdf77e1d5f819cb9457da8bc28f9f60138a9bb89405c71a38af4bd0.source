// Messages are paper. TTL messages are paper that will burn.
// Self right-aligned (convention wins); others left with ink dot
// and alias. Consecutive messages within 3 minutes collapse
// timestamps to the last of the group.

"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Copy,
  Eye,
  FileText,
  Film,
  Flame,
  Hourglass,
  Image as ImageIcon,
  Mail,
  MailOpen,
  Music,
  PenLine,
  Reply,
} from "lucide-react";
import { toast } from "sonner";
import { InkMark } from "@/components/cc/mark";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { fmtBytes, fmtTime, fmtTtlRemaining } from "@/lib/format";
import {
  REACTION_LABELS,
  REACTION_MARKS,
  type MemberPublic,
  type MessageView,
  type ReplySnapshot,
} from "@/lib/types";
import { getSession } from "@/lib/session";
import { useApp } from "@/store/app";
import { cn } from "@/lib/utils";

/* Right-click (desktop) or press-and-hold (touch): the affordances
 * a letter needs: answering it, taking the words with you, or
 * burning the page you wrote. Only your own messages can burn. */
function CopyMenu({
  message,
  onBurn,
  onReact,
  onReply,
  myMark,
  children,
}: {
  message: MessageView;
  onBurn?: () => void;
  onReact?: (mark: string) => void;
  onReply?: () => void;
  myMark?: string;
  children: React.ReactNode;
}) {
  const isFile = message.kind === "file" && message.file;
  const value = isFile ? message.file!.name : message.text ?? "";
  const caption = isFile && message.text ? message.text : "";
  const [armed, setArmed] = useState(false);
  async function copyValue(v: string, label: string) {
    try {
      await navigator.clipboard.writeText(v);
      toast(label);
    } catch {
      toast("Copying wasn't permitted by the browser");
    }
  }
  function burn() {
    onBurn?.();
    toast("The message was burned for everyone");
  }
  return (
    <ContextMenu onOpenChange={(open) => !open && setArmed(false)}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-[10rem] rounded-[12px] border-hairline bg-paper p-1 shadow-[0_1px_2px_rgba(28,24,20,0.08)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.3)]">
        {onReply ? (
          <ContextMenuItem
            onSelect={onReply}
            className="gap-2 rounded-[8px] px-2.5 py-2 font-sans text-[13px] text-charcoal focus:bg-wash focus:text-charcoal data-highlighted:bg-wash"
          >
            <Reply className="size-3.5 text-mute" aria-hidden />
            Reply
          </ContextMenuItem>
        ) : null}
        {caption ? (
          <ContextMenuItem
            onSelect={() => copyValue(caption, "Caption copied")}
            className="gap-2 rounded-[8px] px-2.5 py-2 font-sans text-[13px] text-charcoal focus:bg-wash focus:text-charcoal data-highlighted:bg-wash"
          >
            <Copy className="size-3.5 text-mute" aria-hidden />
            Copy caption
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem
          onSelect={() => copyValue(value, isFile ? "File name copied" : "Message copied")}
          className="gap-2 rounded-[8px] px-2.5 py-2 font-sans text-[13px] text-charcoal focus:bg-wash focus:text-charcoal data-highlighted:bg-wash"
        >
          <Copy className="size-3.5 text-mute" aria-hidden />
          {isFile ? "Copy file name" : "Copy text"}
        </ContextMenuItem>
        {onReact ? (
          <>
            <ContextMenuSeparator className="my-1 bg-hairline" />
            <ContextMenuSub>
              <ContextMenuSubTrigger className="gap-2 rounded-[8px] px-2.5 py-2 font-sans text-[13px] text-charcoal data-highlighted:bg-wash data-highlighted:text-charcoal data-state-open:bg-wash">
                <PenLine className="size-3.5 text-mute" aria-hidden />
                Mark this message
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="min-w-[11rem] rounded-[12px] border-hairline bg-paper p-1 shadow-[0_1px_2px_rgba(28,24,20,0.08)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.3)]">
                {REACTION_MARKS.map((m) => (
                  <ContextMenuItem
                    key={m}
                    onSelect={() => onReact(m)}
                    className="gap-2 rounded-[8px] px-2.5 py-2 font-sans text-[13px] text-charcoal focus:bg-wash focus:text-charcoal data-highlighted:bg-wash"
                  >
                    <span
                      className="w-4 text-center font-serif text-[14px] leading-none text-forest"
                      aria-hidden
                    >
                      {m}
                    </span>
                    {REACTION_LABELS[m]}
                    {myMark === m ? (
                      <span className="ml-auto size-1.5 rounded-full bg-forest" aria-label="Your mark" />
                    ) : null}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
          </>
        ) : null}
        {onBurn ? (
          <>
            <ContextMenuSeparator className="my-1 bg-hairline" />
            <ContextMenuItem
              onSelect={(e) => {
                if (!armed) {
                  // First press asks the question; the second answers it.
                  e.preventDefault();
                  setArmed(true);
                  return;
                }
                burn();
              }}
              className={cn(
                "gap-2 rounded-[8px] px-2.5 py-2 font-sans text-[13px] transition-colors duration-150 focus:text-paper data-highlighted:text-paper",
                armed
                  ? "bg-terracotta text-paper focus:bg-terracotta data-highlighted:bg-terracotta"
                  : "text-terracotta focus:bg-terracotta/10 data-highlighted:bg-terracotta/10",
              )}
            >
              <Flame className="size-3.5" aria-hidden />
              {armed ? "Burn for everyone" : "Burn message"}
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function SystemLine({ text }: { text: string }) {
  return (
    <p className="settle px-8 py-2.5 text-center font-sans text-[11.5px] leading-[17px] text-mute">
      {text}
    </p>
  );
}

/** TTL remaining life: the hourglass carries the terracotta signal,
 *  the label stays in the machine voice. In its final ten seconds
 *  the whole label breathes faster (ttl-final), urgency in rhythm
 *  on top of the colour it already carries. */
function TtlRemaining({ expiresAt }: { expiresAt: number }) {
  const [remaining, setRemaining] = useState(() => expiresAt - Date.now());
  useEffect(() => {
    const t = setInterval(() => {
      setRemaining(expiresAt - Date.now());
    }, 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  const label = fmtTtlRemaining(remaining);
  const final = remaining > 0 && remaining < 10_000;
  return (
    <span className={cn("inline-flex items-center gap-1", final && "ttl-final")}>
      <Hourglass className="size-[11px] text-terracotta" aria-hidden />
      {label}
    </span>
  );
}

/* ---------------- ink marks ---------------- */

const EMPTY_MEMBERS_LIST: { memberId: string; alias: string }[] = [];
const EMPTY_QUOTABLE: MemberPublic[] = [];

/** The readers' margin notes: one quiet chip per mark, serif glyph and
 *  a count, held under the bubble it annotates. Pressing a chip toggles
 *  your own mark; the tooltip names who wrote in the margin. */
function MarksBar({
  message,
  onReact,
}: {
  message: MessageView;
  onReact?: (mark: string) => void;
}) {
  const roomId = useApp((s) => s.activeRoomId);
  const meId = roomId ? getSession(roomId)?.memberId : undefined;
  const members = useApp((s) => (roomId ? s.members[roomId] : undefined)) ?? EMPTY_MEMBERS_LIST;

  const marks = Object.entries(message.marks ?? {}) as [string, string[]][];
  if (marks.length === 0) return null;

  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {marks.map(([mark, ids]) => {
        if (ids.length === 0) return null;
        const mine = !!meId && ids.includes(meId);
        const who = ids
          .map(
            (id) =>
              members.find((m) => m.memberId === id)?.alias ??
              (id === meId ? "You" : "Someone who left"),
          )
          .join(", ");
        const label = REACTION_LABELS[mark as keyof typeof REACTION_LABELS];
        return (
          <button
            key={mark}
            type="button"
            onClick={() => onReact?.(mark)}
            disabled={!onReact}
            aria-pressed={mine}
            aria-label={`${label} - ${who}`}
            title={who}
            className={cn(
              "mark-chip relative flex h-[26px] items-center gap-1.5 rounded-full border px-2.5 font-sans text-[11.5px] font-medium tabular-nums transition duration-150 before:absolute before:-inset-x-1.5 before:-inset-y-[9px] before:content-['']",
              mine
                ? "border-forest/40 bg-forest/10 text-forest hover:border-forest/60"
                : "border-hairline bg-paper text-mute hover:border-forest/30 hover:text-charcoal",
              !onReact && "pointer-events-none",
            )}
          >
            <span className="font-serif text-[13px] leading-none" aria-hidden>
              {mark}
            </span>
            <span className="mark-count" key={ids.length}>
              {ids.length}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export interface BubblePosition {
  first: boolean;
  last: boolean;
  showTime: boolean;
}

/* ---------------- quoted replies ---------------- */

/** The strip of the message being answered, a small letter inside
 *  the letter. The quoted sender's own ink colours its edge; the
 *  snippet is a copy carried by the reply itself (already shown to
 *  the room), so the quote survives the original burning. Tapping
 *  it jumps to the original when it is still in this session's
 *  memory. */
function QuoteBlock({
  replyTo,
  onJump,
}: {
  replyTo: ReplySnapshot;
  onJump?: (id: string) => void;
}) {
  const roomId = useApp((s) => s.activeRoomId);
  const meId = roomId ? getSession(roomId)?.memberId : undefined;
  const members =
    useApp((s) => (roomId ? s.members[roomId] : undefined)) ?? EMPTY_QUOTABLE;
  const quoted = members.find((m) => m.memberId === replyTo.senderId);
  const alias = quoted?.alias ?? (replyTo.senderId === meId ? "You" : "Someone");
  const ink = quoted ? `var(--ink-${quoted.colorIdx})` : undefined;

  return (
    <button
      type="button"
      onClick={() => onJump?.(replyTo.id)}
      aria-label={`Quoted message from ${alias}. ${
        onJump ? "Jump to the original" : "The original is no longer in this session"
      }`}
      className={cn(
        "mb-1.5 flex w-full max-w-full items-start gap-2 rounded-[8px] border-l-2 py-1.5 pl-2.5 pr-2 text-left transition duration-150",
        onJump
          ? "cursor-pointer hover:bg-wash/70 active:bg-wash"
          : "cursor-default",
      )}
      style={{ borderColor: ink ?? "var(--hairline)" }}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span
          className="truncate font-sans text-[11.5px] font-semibold leading-[15px]"
          style={{ color: ink ?? "var(--mute)" }}
        >
          {alias}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 font-sans text-[12px] leading-[17px] text-mute">
          {replyTo.file ? (
            <FileText className="size-3 shrink-0" aria-hidden />
          ) : null}
          <span className="truncate">{replyTo.snippet}</span>
        </span>
      </span>
    </button>
  );
}

export function MessageBubble({
  message,
  position,
  onOpenFile,
  onBurn,
  onReply,
  onJumpToMessage,
}: {
  message: MessageView;
  position: BubblePosition;
  onOpenFile: (message: MessageView) => void;
  onBurn?: () => void;
  onReply?: () => void;
  onJumpToMessage?: (id: string) => void;
}) {
  const self = message.self;
  const burning = message.status === "burning";
  const reactable = message.kind !== "system" && message.status !== "sending" && !burning;
  const roomId = useApp((s) => s.activeRoomId);
  const reactToMessage = useApp((s) => s.reactToMessage);
  const meId = roomId ? getSession(roomId)?.memberId : undefined;
  const myMark = useMemo(
    () =>
      meId && message.marks
        ? (Object.keys(message.marks) as (keyof typeof message.marks)[]).find((k) =>
            (message.marks![k] ?? []).includes(meId),
          )
        : undefined,
    [meId, message.marks],
  );
  const onReact = reactable
    ? (mark: string) => {
        if (roomId) reactToMessage(roomId, message.id, mark);
      }
    : undefined;

  return (
    <div
      data-mid={message.id}
      className={cn(
        "group/row flex w-full",
        self ? "justify-end" : "justify-start",
        position.first ? "mt-3" : "mt-1",
      )}
    >
      <div className={cn("relative flex max-w-[75%] flex-col", self ? "items-end" : "items-start")}>
        {/* sender identity, first of a group only. The mark is a
            fleck of the same vanishing ink in the sender's own colour:
            everyone's identity is a fleck of the same leaving. */}
        {!self && position.first && message.senderAlias != null ? (
          <p
            className="mb-1.5 flex items-center gap-1.5 font-serif text-[13px] font-medium leading-[18px]"
            style={{ color: `var(--ink-${message.senderColor ?? 0})` }}
          >
            <InkMark
              variant="fleck"
              size={13}
              className="shrink-0 translate-y-px"
            />
            {message.senderAlias}
          </p>
        ) : null}

        {/* the reply affordance that lives beside the bubble, a
            mouse thing (touch uses press-and-hold); it only breathes
            when the row is visited */}
        {onReply ? (
          <button
            type="button"
            aria-label="Reply to this message"
            onClick={onReply}
            className={cn(
              "absolute top-0 z-10 flex size-8 items-center justify-center rounded-[8px] text-mute opacity-0 transition duration-150 hover:bg-wash hover:text-charcoal focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest/45 group-hover/row:opacity-100",
              self ? "-left-10" : "-right-10",
            )}
          >
            <Reply className="size-4" aria-hidden />
          </button>
        ) : null}

        <CopyMenu
          message={message}
          onBurn={self && message.status === "sent" ? onBurn : undefined}
          onReact={onReact}
          onReply={onReply}
          myMark={myMark}
        >
          <div
            onDoubleClick={onReply}
            className={cn(
              "px-3.5 py-2",
              self ? "msg-in-self" : "msg-in-other",
              self
                ? cn("bubble-self", position.first && "rounded-tr-[6px]", position.last && "rounded-br-[6px]", !position.first && !position.last && "rounded-tr-[18px] rounded-br-[18px]")
                : cn("bubble-other", position.first && "rounded-tl-[6px]", position.last && "rounded-bl-[6px]"),
              message.status === "sending" && "opacity-60",
              burning && "msg-burning",
            )}
          >
            {message.replyTo ? (
              <QuoteBlock replyTo={message.replyTo} onJump={onJumpToMessage} />
            ) : null}
            {message.kind === "file" && message.file ? (
              <>
                {message.text ? (
                  <p className="t-body mb-1.5 whitespace-pre-wrap break-words">{message.text}</p>
                ) : null}
                <FileContent message={message} onOpenFile={onOpenFile} />
              </>
            ) : (
              <p className="t-body whitespace-pre-wrap break-words">{message.text}</p>
            )}
          </div>
        </CopyMenu>

        {/* ink margin marks, the readers' annotations */}
        {reactable && message.marks && Object.keys(message.marks).length > 0 ? (
          <MarksBar message={message} onReact={onReact} />
        ) : null}

        {/* meta: the machine's voice, under the last of a group */}
        {position.last || message.ttlSec ? (
          <p
            className={cn(
              "t-meta mt-1.5 flex items-center gap-2 whitespace-nowrap tabular-nums",
              burning && "opacity-0 transition-opacity duration-150",
            )}
          >
            {message.status === "sending" ? (
              <span className="inline-flex items-center gap-1">
                <span className="dot-pulse size-1.5 rounded-full bg-mute" aria-hidden />
                Sending
              </span>
            ) : position.last ? (
              <span>{fmtTime(message.ts)}</span>
            ) : null}
            {message.ttlSec && !burning ? (
              <TtlRemaining expiresAt={message.expiresAt ?? message.ts} />
            ) : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/* ---------------- file cards ---------------- */

function FileContent({
  message,
  onOpenFile,
}: {
  message: MessageView;
  onOpenFile: (message: MessageView) => void;
}) {
  const file = message.file;
  if (!file) return null;

  // View-once: sealed until opened, spent forever after.
  if (message.viewOnce) {
    if (message.spent) {
      return (
        <div className="spent-card flex w-[230px] max-w-full items-center gap-3 p-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-paper text-ember">
            <MailOpen className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate font-sans text-[13px] font-medium text-charcoal">
              {file.name}
            </p>
            <p className="t-meta mt-0.5">Opened - the contents are gone</p>
          </div>
        </div>
      );
    }
    return (
      <button
        type="button"
        onClick={() => onOpenFile(message)}
        className="group flex w-[230px] max-w-full items-center gap-3 rounded-[10px] border border-hairline bg-paper p-3 text-left transition duration-150 hover:border-forest/30 hover:bg-wash active:translate-y-px"
        aria-label="Open sealed file - it can be opened once"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-wash text-forest transition-colors duration-150 group-hover:bg-forest/10">
          <Mail className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="font-sans text-[13px] font-medium text-charcoal">Sealed</p>
          <p className="t-meta mt-0.5">View once - opening destroys it</p>
        </div>
      </button>
    );
  }

  const isImage = file.mime.startsWith("image/");
  const isVideo = file.mime.startsWith("video/");
  const isAudio = file.mime.startsWith("audio/");
  if (isImage) {
    return (
      <button
        type="button"
        onClick={() => onOpenFile(message)}
        className="group block w-full text-left"
        aria-label={`View image ${file.name}`}
      >
        <img
          src={`data:${file.mime};base64,${file.dataB64}`}
          alt={file.name}
          className="max-h-56 w-full rounded-[10px] object-cover transition duration-150 group-hover:brightness-95"
        />
        <p className="t-meta mt-1.5 px-0.5">
          {file.name} · {fmtBytes(file.size)}
        </p>
      </button>
    );
  }

  // Every remaining file opens IN THE APP. The viewer decides what
  // "opening" means per type (play, read, inspect bytes). Downloading
  // is a choice the viewer offers, never the card's whole job.
  const Icon = isVideo ? Film : isAudio ? Music : FileText;
  const kindLabel = isVideo ? "Video" : isAudio ? "Audio" : "File";
  return (
    <button
      type="button"
      onClick={() => onOpenFile(message)}
      className="group flex w-[230px] max-w-full items-center gap-3 rounded-[10px] border border-hairline bg-paper p-2.5 text-left transition duration-150 hover:border-forest/30 hover:bg-wash active:translate-y-px"
      aria-label={`Open ${kindLabel.toLowerCase()} ${file.name} in the viewer`}
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-[8px] text-forest transition-colors duration-150",
          isVideo || isAudio ? "bg-forest/10" : "bg-wash group-hover:bg-forest/10",
        )}
        aria-hidden
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-sans text-[13px] font-medium text-charcoal">
          {file.name}
        </span>
        <span className="t-meta mt-0.5 block">
          {kindLabel} · {fmtBytes(file.size)}
        </span>
      </span>
      <Eye
        className="size-4 shrink-0 text-mute transition-colors duration-150 group-hover:text-forest"
        aria-hidden
      />
    </button>
  );
}

export function downloadFile(name: string, mime: string, dataB64: string) {
  try {
    const binary = atob(dataB64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast("File downloaded");
  } catch {
    toast("The file could not be decoded");
  }
}

/* ---------------- message grouping ---------------- */

export function useMessageGroups(messages: MessageView[]) {
  return useMemo(() => {
    const out: { message: MessageView; position: BubblePosition }[] = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.kind === "system") {
        out.push({ message: m, position: { first: true, last: true, showTime: false } });
        continue;
      }
      const prev = messages[i - 1];
      const next = messages[i + 1];
      const sameAsPrev =
        prev && prev.kind !== "system" && prev.senderId === m.senderId && m.ts - prev.ts < 3 * 60 * 1000;
      const sameAsNext =
        next && next.kind !== "system" && next.senderId === m.senderId && next.ts - m.ts < 3 * 60 * 1000;
      out.push({
        message: m,
        position: {
          first: !sameAsPrev,
          last: !sameAsNext,
          showTime: !sameAsNext,
        },
      });
    }
    return out;
  }, [messages]);
}
