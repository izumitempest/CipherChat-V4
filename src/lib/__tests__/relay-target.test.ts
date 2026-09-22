import { describe, expect, it } from "vitest";
import { parseRelayTarget } from "../relay";

// The wiring between NEXT_PUBLIC_RELAY_URL and what reaches the wire.
// socket.io-client v4 turns a URL's path into a NAMESPACE and sends
// engine.io requests to opts.path — these tests pin the split so the
// URL's path can never silently become a namespace the relay never
// registered (the compose-Caddy failure the CI golden path caught).

describe("relay target parsing", () => {
  it("keeps /relay/ as the engine.io request path, never a namespace (the compose Caddy route)", () => {
    // handle_path /relay/* strips the prefix; the relay (server path
    // "/") then answers on "/". If this value ever reached io() as a
    // URL, the client would request the unregistered "/relay/"
    // namespace over requests to /socket.io/ — which Caddy routes to
    // the web container, not the relay.
    expect(parseRelayTarget("/relay/")).toEqual({
      origin: null,
      path: "/relay/",
      query: "",
    });
  });

  it("preserves the sandbox gateway's query routing verbatim", () => {
    // The gateway forwards by the XTransformPort query, not by path;
    // the query must survive the split exactly as written.
    expect(parseRelayTarget("/?XTransformPort=3003")).toEqual({
      origin: null,
      path: "/",
      query: "XTransformPort=3003",
    });
  });

  it("supports a bare same-origin root", () => {
    expect(parseRelayTarget("/")).toEqual({
      origin: null,
      path: "/",
      query: "",
    });
  });

  it("keeps the origin for absolute relay URLs", () => {
    expect(parseRelayTarget("https://relay.example.com")).toEqual({
      origin: "https://relay.example.com",
      path: "/",
      query: "",
    });
  });

  it("keeps origin AND path for absolute URLs with a proxy prefix", () => {
    expect(parseRelayTarget("https://relay.example.com/relay/")).toEqual({
      origin: "https://relay.example.com",
      path: "/relay/",
      query: "",
    });
  });

  it("tolerates a missing trailing slash (engine.io adds it back)", () => {
    // engine.io-client normalizes `path.replace(/\/$/, "") + "/"`, so
    // the unpunctuated form must still round-trip the same prefix.
    expect(parseRelayTarget("/relay").path).toBe("/relay");
    expect(parseRelayTarget("https://r.example.com/relay").path).toBe(
      "/relay",
    );
  });

  it("keeps non-trivial queries intact (no reordering, no dropping)", () => {
    const t = parseRelayTarget("/?XTransformPort=3003&XDebug=1");
    expect(t.query).toBe("XTransformPort=3003&XDebug=1");
    expect(t.path).toBe("/");
  });
});
