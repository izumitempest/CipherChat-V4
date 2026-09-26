// The file viewer. Every file opens IN THE APP. Images show
// contained and zoomable; video and audio play from memory; PDFs
// render to a canvas (no toolbar, no save button); text, code, CSV
// and even binary bytes are read right here. A view-once file is
// spent the moment it opens. And for view-once files there is NO
// download anywhere: viewing is the point, and the plaintext never
// touches the disk through us.
//
// Everything rendered here is decrypted bytes held in memory, fed to
// the element through a revocable blob URL. Nothing is fetched, and
// nothing is written. Text-ish files are rendered as TEXT (React
// escaping): HTML is shown as source, never executed; SVG rides an
// <img> context where scripts cannot run.

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Copy,
  Download,
  FileText,
  Music,
  ShieldCheck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { downloadFile } from "@/components/cc/bubble";
import { fmtBytes } from "@/lib/format";
import type { MessageView } from "@/lib/types";
import { cn } from "@/lib/utils";

/* ---------------- classification ---------------- */

export type FileCategory =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "text"
  | "csv"
  | "binary";

const TEXT_EXTS = new Set([
  "txt", "md", "markdown", "log", "json", "xml", "js", "mjs", "cjs",
  "ts", "tsx", "jsx", "css", "scss", "html", "htm", "yaml", "yml",
  "toml", "ini", "cfg", "conf", "sh", "bash", "zsh", "py", "rb",
  "rs", "go", "java", "c", "h", "cpp", "hpp", "cs", "swift", "sql",
  "svg", "gitignore", "env", "lock",
]);

export function classifyFile(mime: string, name: string): FileCategory {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (mime === "text/csv" || ext === "csv") return "csv";
  if (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "application/javascript" ||
    mime === "application/x-yaml" ||
    TEXT_EXTS.has(ext)
  ) {
    return "text";
  }
  return "binary";
}

/* ---------------- decoding helpers ---------------- */

function b64ToBytes(dataB64: string): Uint8Array {
  const binary = atob(dataB64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** How much of a text file is rendered inline: enough to read a
 *  letter or review a config; the rest would only weigh the DOM. */
export const TEXT_SHOW_MAX = 100_000;

/* ---------------- CSV parsing ---------------- */

/** Quote-aware CSV split (RFC 4180 in spirit: double quotes escape a
 *  quote, quoted fields may hold commas and newlines). Pure function:
 *  the tests in task-29 reach it directly. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else if (c === "\r") {
      // tolerated: CRLF line endings
      if (text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

const CSV_MAX_ROWS = 500;
const CSV_MAX_COLS = 32;

/* ---------------- the viewer ---------------- */

export function FileViewer({
  message,
  onClose,
  onSpent,
}: {
  message: MessageView | null;
  onClose: () => void;
  onSpent: (message: MessageView) => void;
}) {
  const [zoomFor, setZoomFor] = useState<string | null>(null);
  const [wrap, setWrap] = useState(true);
  // The bytes live once, in memory, behind a revocable blob URL.
  // Opening a different file (or closing) revokes the previous URL:
  // the blob is released and the bytes are left to the GC.
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const category = message?.file
    ? classifyFile(message.file.mime, message.file.name)
    : null;
  const viewOnce = !!message?.viewOnce;

  // Derived: zoom belongs to the file being viewed. A new file
  // starts at arm's length, no effect needed.
  const zoomed = !!message && message.id === zoomFor;
  const msgId = message?.id;
  const dataB64 = message?.file?.dataB64;
  const mime = message?.file?.mime ?? "application/octet-stream";

  // State follows the file being viewed. When the message changes
  // (or the viewer closes), zoom, wrap and the decoded bytes adjust
  // during render: the sanctioned pattern, no effect and no cascading
  // renders, and a departing file's plaintext is dropped the instant
  // it is no longer this one.
  const [viewingId, setViewingId] = useState(msgId);
  if (msgId !== viewingId) {
    setViewingId(msgId);
    setZoomFor(null);
    setWrap(true);
    setBytes(null);
    setBlobUrl(null);
  }

  // A view-once file is spent the moment it opens.
  useEffect(() => {
    if (!message?.viewOnce) return;
    onSpent(message);
  }, [message?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The blob is born here and dies with this message. This is an effect
  // for the external system (the URL registry), never for state
  // the render itself can adjust. Storing the created handle in
  // state is the one synchronous setState this component needs;
  // the rule's heuristic has no shape for "effect creates an
  // external resource and remembers it", so it is disabled here,
  // with the reason.
  useEffect(() => {
    if (!msgId || !dataB64) return;
    const b = b64ToBytes(dataB64);
    const url = URL.createObjectURL(new Blob([b as unknown as BlobPart], { type: mime }));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBytes(b);
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [msgId]);

  const decodedText = useMemo(() => {
    if (!bytes || (category !== "text" && category !== "csv")) return null;
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }, [bytes, category]);

  if (!message?.file) return null;
  const file = message.file;

  async function copyText() {
    if (!decodedText) return;
    try {
      await navigator.clipboard.writeText(decodedText);
      toast("Contents copied");
    } catch {
      toast("Copying wasn't permitted by the browser");
    }
  }

  const isHtmlSource =
    category === "text" &&
    (file.mime === "text/html" || /\.html?$/i.test(file.name));

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-paper/95 backdrop-blur-[16px]"
      role="dialog"
      aria-modal="false"
      aria-label={`${category ?? "file"} ${file.name}`}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <p className="t-meta min-w-0 flex-1 truncate px-2">
          {file.name} · {fmtBytes(file.size)} · {file.mime || "unknown type"}
          {viewOnce ? " · view once" : ""}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          {decodedText ? (
            <button
              type="button"
              onClick={copyText}
              aria-label="Copy contents"
              className="flex size-11 items-center justify-center rounded-[12px] text-mute transition-colors duration-150 hover:bg-wash hover:text-charcoal active:bg-wash"
            >
              <Copy className="size-5" />
            </button>
          ) : null}
          {viewOnce ? null : (
            <button
              type="button"
              onClick={() =>
                downloadFile(file.name, file.mime, file.dataB64 ?? "")
              }
              aria-label="Download a copy"
              className="flex size-11 items-center justify-center rounded-[12px] text-mute transition-colors duration-150 hover:bg-wash hover:text-charcoal active:bg-wash"
            >
              <Download className="size-5" />
            </button>
          )}
          <button
            type="button"
            aria-label="Close viewer"
            onClick={onClose}
            className="flex size-11 items-center justify-center rounded-[12px] text-mute transition-colors duration-150 hover:bg-wash hover:text-charcoal active:bg-wash"
          >
            <X className="size-5" />
          </button>
        </div>
      </div>

      {viewOnce ? (
        <p className="t-meta flex items-center gap-1.5 px-5 pb-2">
          <ShieldCheck className="size-3.5 shrink-0 text-forest" aria-hidden />
          View once - it lives on screen only. There is no download for
          this file, from anyone, by design.
        </p>
      ) : null}

      <div
        className={cn(
          "flex flex-1 justify-center overflow-auto px-5 pb-10",
          zoomed ? "items-start" : "items-center",
        )}
      >
        {category === "image" && blobUrl ? (
          <img
            src={blobUrl}
            alt={file.name}
            onClick={() => setZoomFor(zoomed ? null : message.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setZoomFor(zoomed ? null : message.id);
              }
            }}
            tabIndex={0}
            role="button"
            aria-label={`${file.name} - ${zoomed ? "zoom out" : "zoom in"}`}
            className={cn(
              "settle rounded-[12px] border border-hairline object-contain shadow-float outline-none focus-visible:ring-2 focus-visible:ring-forest/45 focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
              zoomed
                ? "h-auto max-h-none w-[220%] max-w-none cursor-zoom-out"
                : "max-h-full max-w-full cursor-zoom-in",
            )}
          />
        ) : category === "video" && blobUrl ? (
          <video
            src={blobUrl}
            controls
            playsInline
            controlsList="nodownload noremoteplayback"
            disablePictureInPicture={viewOnce}
            onContextMenu={viewOnce ? (e) => e.preventDefault() : undefined}
            aria-label={`Video ${file.name}`}
            className="settle max-h-full max-w-full rounded-[12px] border border-hairline bg-black shadow-float"
          />
        ) : category === "audio" && blobUrl ? (
          <div className="settle flex w-full max-w-[420px] flex-col items-center rounded-[18px] border border-hairline bg-side p-6 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-forest/10 text-forest">
              <Music className="size-6" aria-hidden />
            </span>
            <p className="t-body mt-4 max-w-full truncate">{file.name}</p>
            <p className="t-meta mt-1">{fmtBytes(file.size)}</p>
            <audio
              src={blobUrl}
              controls
              controlsList="nodownload noremoteplayback"
              onContextMenu={viewOnce ? (e) => e.preventDefault() : undefined}
              aria-label={`Audio ${file.name}`}
              className="mt-5 w-full"
            />
          </div>
        ) : category === "pdf" && bytes ? (
          <PdfView
            bytes={bytes}
            blobUrl={blobUrl}
            viewOnce={viewOnce}
            name={file.name}
          />
        ) : category === "csv" && decodedText !== null ? (
          <CsvTable text={decodedText} name={file.name} />
        ) : category === "text" && decodedText !== null ? (
          <div className="settle flex h-full w-full max-w-[860px] flex-col rounded-[14px] border border-hairline bg-side">
            <div className="flex items-center justify-between gap-2 border-b border-hairline px-4 py-2.5">
              <p className="t-meta truncate">
                {isHtmlSource
                  ? "Shown as source: HTML is never executed here"
                  : "Plain text"}
              </p>
              <button
                type="button"
                onClick={() => setWrap((w) => !w)}
                aria-pressed={wrap}
                className="rounded-[6px] border border-hairline bg-paper px-2.5 py-1 font-sans text-[11.5px] font-medium text-charcoal transition-colors duration-150 hover:bg-wash"
              >
                {wrap ? "No wrap" : "Wrap"}
              </button>
            </div>
            <pre
              className={cn(
                "flex-1 overflow-auto px-4 py-3 font-mono text-[12.5px] leading-[19px] text-charcoal",
                wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre",
              )}
            >
              {decodedText.length > TEXT_SHOW_MAX
                ? decodedText.slice(0, TEXT_SHOW_MAX)
                : decodedText}
            </pre>
            {decodedText.length > TEXT_SHOW_MAX ? (
              <p className="t-meta border-t border-hairline px-4 py-2">
                Showing the first {fmtBytes(TEXT_SHOW_MAX)} of{" "}
                {fmtBytes(decodedText.length)}. Copy takes the whole file.
              </p>
            ) : null}
          </div>
        ) : category === "binary" && bytes ? (
          <div className="settle flex w-full max-w-[720px] flex-col gap-4">
            <div className="rounded-[18px] border border-hairline bg-side p-6 text-center">
              <span className="mx-auto flex size-12 items-center justify-center rounded-[12px] bg-paper text-forest">
                <FileText className="size-5" aria-hidden />
              </span>
              <p className="t-body mt-4 break-words">{file.name}</p>
              <p className="t-meta mt-1">
                {fmtBytes(file.size)} · inspected in memory, first bytes
                below
              </p>
            </div>
            <div className="overflow-hidden rounded-[14px] border border-hairline bg-side">
              <HexDump bytes={bytes} />
            </div>
          </div>
        ) : (
          <p className="t-meta">Opening…</p>
        )}
      </div>
    </div>
  );
}

/* ---------------- hex inspection ---------------- */

function HexDump({ bytes }: { bytes: Uint8Array }) {
  const lines = useMemo(() => {
    const n = Math.min(bytes.length, 512);
    const out: string[] = [];
    for (let off = 0; off < n; off += 16) {
      const slice = bytes.subarray(off, Math.min(off + 16, n));
      const hex = Array.from(slice, (b) => b.toString(16).padStart(2, "0"))
        .join(" ")
        .padEnd(47, " ");
      const ascii = Array.from(slice, (b) =>
        b >= 32 && b < 127 ? String.fromCharCode(b) : "\u00b7",
      ).join("");
      out.push(`${off.toString(16).padStart(8, "0")}  ${hex}  ${ascii}`);
    }
    return out;
  }, [bytes]);
  return (
    <div className="max-h-[46vh] overflow-auto">
      <pre className="px-4 py-3 font-mono text-[11.5px] leading-[18px] text-mute">
        {lines.join("\n")}
      </pre>
      <p className="t-meta border-t border-hairline px-4 py-2">
        {bytes.length > 512
          ? `First 512 of ${fmtBytes(bytes.length)} bytes`
          : `${bytes.length} bytes`}
      </p>
    </div>
  );
}

/* ---------------- CSV table ---------------- */

function CsvTable({ text, name }: { text: string; name: string }) {
  const table = useMemo(() => {
    const rows = parseCsv(text);
    const truncatedRows = rows.length > CSV_MAX_ROWS;
    const shown = rows.slice(0, CSV_MAX_ROWS).map((r) => r.slice(0, CSV_MAX_COLS));
    const truncatedCols = rows.some(
      (r) => r.length > CSV_MAX_COLS || (r.length === CSV_MAX_COLS && r[CSV_MAX_COLS - 1] === "" && false),
    );
    return { shown, truncatedRows, truncatedCols };
  }, [text]);
  const [head, ...body] = table.shown;
  return (
    <div className="settle flex h-full w-full max-w-[900px] flex-col overflow-hidden rounded-[14px] border border-hairline bg-side">
      <div className="flex items-center justify-between gap-2 border-b border-hairline px-4 py-2.5">
        <p className="t-meta truncate">
          {name} - {table.shown.length} rows
          {table.truncatedRows ? " (truncated for reading)" : ""}
        </p>
        <p className="t-meta">comma-separated, rendered as a table</p>
      </div>
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse font-mono text-[12px]">
          <thead className="sticky top-0 bg-paper">
            <tr>
              {head?.map((cell, i) => (
                <th
                  key={i}
                  scope="col"
                  className="border-b border-hairline px-3 py-2 text-left font-semibold text-charcoal"
                >
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, r) => (
              <tr key={r} className="odd:bg-paper/60">
                {row.map((cell, c) => (
                  <td
                    key={c}
                    className="max-w-[260px] truncate border-b border-hairline/60 px-3 py-1.5 text-charcoal"
                    title={cell}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.truncatedCols ? (
        <p className="t-meta border-t border-hairline px-4 py-2">
          Wide rows were clipped to {CSV_MAX_COLS} columns. Copy takes the
          whole file.
        </p>
      ) : null}
    </div>
  );
}

/* ---------------- PDF on canvas ---------------- */

function PdfView({
  bytes,
  blobUrl,
  viewOnce,
  name,
}: {
  bytes: Uint8Array;
  blobUrl: string | null;
  viewOnce: boolean;
  name: string;
}) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<any>(null);
  const taskRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        // pdf.js transfers the buffer; hand it a copy so our bytes stay ours.
        const task = pdfjs.getDocument({ data: bytes.slice() });
        taskRef.current = task;
        const doc = await task.promise;
        if (cancelled) {
          task.destroy().catch(() => undefined);
          return;
        }
        docRef.current = doc;
        setNumPages(doc.numPages);
        setState("ready");
      } catch {
        if (!cancelled) setState("failed");
      }
    })();
    return () => {
      cancelled = true;
      docRef.current = null;
      // A destroyed task rejects its in-flight promise; that refusal
      // is expected during teardown and must not surface anywhere.
      taskRef.current?.destroy?.().catch?.(() => undefined);
      taskRef.current = null;
    };
  }, [bytes]);

  useEffect(() => {
    if (state !== "ready" || !numPages) return;
    let cancelled = false;
    (async () => {
      try {
        const doc = docRef.current;
        if (!doc) return;
        const p = await doc.getPage(Math.min(page, numPages));
        if (cancelled) return;
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return;
        const availW = Math.max(240, (wrapRef.current?.clientWidth ?? 640) - 24);
        const availH = Math.max(280, (wrapRef.current?.clientHeight ?? 520) - 24);
        const base = p.getViewport({ scale: 1 });
        const scale = Math.min(availW / base.width, availH / base.height, 2);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = p.getViewport({ scale: scale * dpr });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
        canvas.dataset.renderError = "";
        await p.render({ canvas, canvasContext: ctx, viewport }).promise;
        canvas.dataset.renderError = "ok";
      } catch (err) {
        // A page that cannot render (corrupt or hostile PDF) is a
        // failed view, not a blank one. The fallback (or, for
        // view-once, the sealed notice) takes over.
        canvasRef.current?.setAttribute(
          "data-render-error",
          err instanceof Error ? err.message : String(err),
        );
        setState("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state, page, numPages]);

  if (state === "failed") {
    // The canvas path could not load. For a view-once file that
    // means the browser's PDF toolbar (with its own save button)
    // would be the only way to show it, so it stays encrypted instead.
    // Regular files fall back to the browser viewer, honestly.
    if (viewOnce) {
      return (
        <div className="settle w-full max-w-[340px] rounded-[18px] border border-hairline bg-side p-6 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-[12px] bg-paper text-ember">
            <FileText className="size-5" aria-hidden />
          </span>
          <p className="t-body mt-4">The PDF viewer could not load</p>
          <p className="t-meta mt-1">
            This file stays sealed rather than fall back to a viewer with a
            save button. Ask the sender to share it again if needed.
          </p>
        </div>
      );
    }
    return (
      <iframe
        src={blobUrl ?? undefined}
        title={`PDF ${name}`}
        className="h-full w-full max-w-[900px] rounded-[12px] border border-hairline bg-paper"
      />
    );
  }

  return (
    <div className="flex h-full w-full max-w-[900px] flex-col gap-3">
      <div
        ref={wrapRef}
        className="flex flex-1 justify-center overflow-auto"
        aria-live="polite"
      >
        <canvas
          ref={canvasRef}
          className="settle rounded-[12px] border border-hairline bg-paper shadow-float"
          aria-label={`PDF ${name}, page ${Math.min(page, numPages ?? 1)} of ${numPages ?? "?"}`}
        />
      </div>
      <div className="flex items-center justify-center gap-3 pb-1">
        <button
          type="button"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1}
          aria-label="Previous page"
          className="h-10 rounded-[8px] border border-hairline bg-paper px-4 font-sans text-[12.5px] font-medium text-charcoal transition-colors duration-150 hover:bg-wash disabled:pointer-events-none disabled:opacity-40"
        >
          Back
        </button>
        <p className="t-meta w-24 text-center tabular-nums">
          {state === "loading"
            ? "Rendering…"
            : `Page ${Math.min(page, numPages ?? 1)} of ${numPages ?? "?"}`}
        </p>
        <button
          type="button"
          onClick={() => setPage((p) => Math.min(numPages ?? 1, p + 1))}
          disabled={!numPages || page >= numPages}
          aria-label="Next page"
          className="h-10 rounded-[8px] border border-hairline bg-paper px-4 font-sans text-[12.5px] font-medium text-charcoal transition-colors duration-150 hover:bg-wash disabled:pointer-events-none disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}
