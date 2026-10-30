// The body ceiling.
//
// request.json() reads whatever the client sends, and the framework
// buffers it before the route sees a byte. One route with no cap is
// enough to make the process eat a request body it has no use for.
//
// So: one reader, one cap, used by every route under /api/rooms. The
// cap is checked twice. The content-length header says how big the
// body claims to be (cheap, and enough to turn away most junk before
// a byte is read), and the bytes are counted as they arrive (the
// header can lie, so the count is the one that decides).
//
// 64 KB is far above anything the app sends: the biggest body is the
// verifier bundle plus the join proof, well under a kilobyte.

export const API_BODY_MAX_BYTES = 64 * 1024;

export type BodyResult<T> =
  | { ok: true; body: T }
  | { ok: false; reason: "too-large" | "bad-json" };

/** Read a JSON body under the cap.
 *
 *  Returns { ok: false, reason: "too-large" } for a body over the
 *  cap, and { ok: false, reason: "bad-json" } for one that is not
 *  JSON. Never throws: a broken request is an answer, not a crash. */
export async function readJsonBody<T>(request: Request): Promise<BodyResult<T>> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > API_BODY_MAX_BYTES) {
    return { ok: false, reason: "too-large" };
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: false, reason: "bad-json" };

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > API_BODY_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too-large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "bad-json" };
  }

  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  // An empty body is an empty object. A route that wants fields will
  // still fail its own checks.
  if (total === 0) return { ok: true, body: {} as T };
  try {
    const parsed = JSON.parse(new TextDecoder().decode(buf)) as T;
    if (parsed === null || typeof parsed !== "object") {
      return { ok: false, reason: "bad-json" };
    }
    return { ok: true, body: parsed };
  } catch {
    return { ok: false, reason: "bad-json" };
  }
}
