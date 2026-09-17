// Messages are paper. TTL messages are paper that will burn.
// Self right-aligned (convention wins); others left with ink dot
// and alias. Consecutive messages within 3 minutes collapse
// timestamps to the last of the group.

"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Copy,
  Download,
  FileText,
  Flame,
  Hourglass,
  Image as ImageIcon,
  Mail,
  MailOpen,
  PenLine,
} from "lucide-react";
import { toast } from "sonner";
import { SealMark } from "@/components/cc/mark";
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
import { REACTION_LABELS, REACTION_MARKS, type MessageView } from "@/lib/types";
import { getSession } from "@/lib/session";
import { useApp } from "@/store/app";
import { cn } from "@/lib/utils";

/* Right-click (desktop) or press-and-hold (touch) — the quiet
 * affordances a letter needs: taking the words with you, or burning
 * the page you wrote. Only your own messages can burn. */
function CopyMenu({
  message,
  onBurn,
  onReact,
  myMark,
  children,
}: {
  message: MessageView;
  onBurn?: () => void;
  onReact?: (mark: string) => void;
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

/** TTL remaining life — the hourglass carries the terracotta signal,
 *  the label stays in the quiet machine voice. */
function TtlRemaining({ expiresAt }: { expiresAt: number }) {
  const [label, setLabel] = useState(() => fmtTtlRemaining(expiresAt - Date.now()));
  useEffect(() => {
    const t = setInterval(() => {
      setLabel(fmtTtlRemaining(expiresAt - Date.now()));
    }, 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  return (
    <span className="inline-flex items-center gap-1">
      <Hourglass className="size-[11px] text-terracotta" aria-hidden />
      {label}
    </span>
  );
}

/* ---------------- ink marks ---------------- */

const EMPTY_MEMBERS_LIST: { memberId: string; alias: string }[] = [];

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
            aria-label={`${label} — ${who}`}
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

export function MessageBubble({
  message,
  position,
  onOpenFile,
  onBurn,
}: {
  message: MessageView;
  position: BubblePosition;
  onOpenFile: (message: MessageView) => void;
  onBurn?: () => void;
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
      className={cn(
        "flex w-full",
        self ? "justify-end" : "justify-start",
        position.first ? "mt-3" : "mt-1",
      )}
    >
      <div className={cn("flex max-w-[75%] flex-col", self ? "items-end" : "items-start")}>
        {/* sender identity — first of a group only. The mark is a
            fragment of the seal in the sender's own ink: everyone's
            identity is a shard of the same broken ring. */}
        {!self && position.first && message.senderAlias != null ? (
          <p
            className="mb-1.5 flex items-center gap-1.5 font-serif text-[13px] font-medium leading-[18px]"
            style={{ color: `var(--ink-${message.senderColor ?? 0})` }}
          >
            <SealMark
              variant="ring"
              size={13}
              className="shrink-0 translate-y-px"
            />
            {message.senderAlias}
          </p>
        ) : null}

        <CopyMenu
          message={message}
          onBurn={self && message.status === "sent" ? onBurn : undefined}
          onReact={onReact}
          myMark={myMark}
        >
          <div
            className={cn(
              "rise px-3.5 py-2",
              self
                ? cn("bubble-self", position.first && "rounded-tr-[6px]", position.last && "rounded-br-[6px]", !position.first && !position.last && "rounded-tr-[18px] rounded-br-[18px]")
                : cn("bubble-other", position.first && "rounded-tl-[6px]", position.last && "rounded-bl-[6px]"),
              message.status === "sending" && "opacity-60",
              burning && "msg-burning",
            )}
          >
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

        {/* ink margin marks — the readers' quiet annotations */}
        {reactable && message.marks && Object.keys(message.marks).length > 0 ? (
          <MarksBar message={message} onReact={onReact} />
        ) : null}

        {/* meta — the machine's voice, under the last of a group */}
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
            <p className="t-meta mt-0.5">Opened — the contents are gone</p>
          </div>
        </div>
      );
    }
    return (
      <button
        type="button"
        onClick={() => onOpenFile(message)}
        className="group flex w-[230px] max-w-full items-center gap-3 rounded-[10px] border border-hairline bg-paper p-3 text-left transition duration-150 hover:border-forest/30 hover:bg-wash active:translate-y-px"
        aria-label="Open sealed file — it can be opened once"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-wash text-forest transition-colors duration-150 group-hover:bg-forest/10">
          <Mail className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="font-sans text-[13px] font-medium text-charcoal">Sealed</p>
          <p className="t-meta mt-0.5">View once — opening destroys it</p>
        </div>
      </button>
    );
  }

  const isImage = file.mime.startsWith("image/");
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

  return (
    <button
      type="button"
      onClick={() => downloadFile(file.name, file.mime, file.dataB64 ?? "")}
      className="group flex w-[230px] max-w-full items-center gap-3 rounded-[10px] border border-hairline bg-paper p-2.5 text-left transition duration-150 hover:border-forest/30 hover:bg-wash active:translate-y-px"
      aria-label={`Download ${file.name}`}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-wash text-forest transition-colors duration-150 group-hover:bg-forest/10">
        <FileText className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-sans text-[13px] font-medium text-charcoal">
          {file.name}
        </span>
        <span className="t-meta mt-0.5 block">{fmtBytes(file.size)}</span>
      </span>
      <Download
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
