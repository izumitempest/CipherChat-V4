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
  Hourglass,
  Image as ImageIcon,
  Mail,
  MailOpen,
} from "lucide-react";
import { toast } from "sonner";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { fmtBytes, fmtTime, fmtTtlRemaining } from "@/lib/format";
import type { MessageView } from "@/lib/types";
import { cn } from "@/lib/utils";

/* Right-click (desktop) or press-and-hold (touch) — the one quiet
 * affordance a letter needs: taking the words with you. */
function CopyMenu({ message, children }: { message: MessageView; children: React.ReactNode }) {
  const isFile = message.kind === "file" && message.file;
  const value = isFile ? message.file!.name : message.text ?? "";
  async function copyText() {
    try {
      await navigator.clipboard.writeText(value);
      toast(isFile ? "File name copied" : "Message copied");
    } catch {
      toast("Copying wasn't permitted by the browser");
    }
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-[10rem] rounded-[12px] border-hairline bg-paper p-1 shadow-[0_1px_2px_rgba(28,24,20,0.08)]">
        <ContextMenuItem
          onSelect={copyText}
          className="gap-2 rounded-[8px] px-2.5 py-2 font-sans text-[13px] text-charcoal focus:bg-wash focus:text-charcoal data-highlighted:bg-wash"
        >
          <Copy className="size-3.5 text-mute" aria-hidden />
          {isFile ? "Copy file name" : "Copy text"}
        </ContextMenuItem>
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

export interface BubblePosition {
  first: boolean;
  last: boolean;
  showTime: boolean;
}

export function MessageBubble({
  message,
  position,
  onOpenFile,
}: {
  message: MessageView;
  position: BubblePosition;
  onOpenFile: (message: MessageView) => void;
}) {
  const self = message.self;
  const burning = message.status === "burning";

  return (
    <div
      className={cn(
        "flex w-full",
        self ? "justify-end" : "justify-start",
        position.first ? "mt-3" : "mt-1",
      )}
    >
      <div className={cn("flex max-w-[75%] flex-col", self ? "items-end" : "items-start")}>
        {/* sender identity — first of a group only */}
        {!self && position.first && message.senderAlias != null ? (
          <p
            className="mb-1.5 flex items-center gap-1.5 font-serif text-[13px] font-medium leading-[18px]"
            style={{ color: `var(--ink-${message.senderColor ?? 0})` }}
          >
            <span
              className="size-2 translate-y-px rounded-full"
              style={{ background: `var(--ink-${message.senderColor ?? 0})` }}
              aria-hidden
            />
            {message.senderAlias}
          </p>
        ) : null}

        <CopyMenu message={message}>
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
              <FileContent message={message} onOpenFile={onOpenFile} />
            ) : (
              <p className="t-body whitespace-pre-wrap break-words">{message.text}</p>
            )}
          </div>
        </CopyMenu>

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
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-wash text-forest">
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
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-wash text-forest">
        <FileText className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-sans text-[13px] font-medium text-charcoal">
          {file.name}
        </span>
        <span className="t-meta mt-0.5 block">{fmtBytes(file.size)}</span>
      </span>
      <Download
        className="size-4 shrink-0 text-mute transition-colors duration-150 group-hover:text-charcoal"
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
