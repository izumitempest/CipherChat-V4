// The file viewer — a full surface, not a modal (centered modals are
// reserved for irreversible moments). Images show contained; other
// files offer their bytes back. A view-once file opened here is spent
// the moment it opens.

"use client";

import { useEffect } from "react";
import { Download, FileText, X } from "lucide-react";
import { downloadFile } from "@/components/cc/bubble";
import { fmtBytes } from "@/lib/format";
import type { MessageView } from "@/lib/types";

export function FileViewer({
  message,
  onClose,
  onSpent,
}: {
  message: MessageView | null;
  onClose: () => void;
  onSpent: (message: MessageView) => void;
}) {
  useEffect(() => {
    if (!message?.viewOnce) return;
    onSpent(message);
  }, [message?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!message?.file) return null;
  const file = message.file;
  const isImage = file.mime.startsWith("image/");

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-paper/95 backdrop-blur-[16px]"
      role="dialog"
      aria-modal="false"
      aria-label={isImage ? `Image ${file.name}` : `File ${file.name}`}
    >
      <div className="flex items-center justify-between px-3 py-2.5">
        <p className="t-meta truncate px-2">
          {file.name} · {fmtBytes(file.size)}
          {message.viewOnce ? " · view once" : ""}
        </p>
        <button
          type="button"
          aria-label="Close viewer"
          onClick={onClose}
          className="flex size-11 items-center justify-center rounded-[12px] text-mute transition-colors duration-150 hover:bg-wash hover:text-charcoal active:bg-wash"
        >
          <X className="size-5" />
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center overflow-hidden px-5 pb-10">
        {isImage && file.dataB64 ? (
          <img
            src={`data:${file.mime};base64,${file.dataB64}`}
            alt={file.name}
            className="settle max-h-full max-w-full rounded-[12px] border border-hairline object-contain shadow-float"
          />
        ) : (
          <div className="settle w-full max-w-[320px] rounded-[18px] border border-hairline bg-side p-6 text-center">
            <span className="mx-auto flex size-12 items-center justify-center rounded-[12px] bg-paper text-forest">
              <FileText className="size-5" aria-hidden />
            </span>
            <p className="t-body mt-4 break-words">{file.name}</p>
            <p className="t-meta mt-1">{fmtBytes(file.size)}</p>
            <button
              type="button"
              onClick={() => downloadFile(file.name, file.mime, file.dataB64 ?? "")}
              className="mx-auto mt-5 flex h-11 items-center gap-2 rounded-[12px] border border-hairline bg-paper px-5 font-sans text-[13.5px] font-medium text-charcoal transition-colors duration-150 hover:bg-wash active:bg-wash"
            >
              <Download className="size-4" aria-hidden />
              Download
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
