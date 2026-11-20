import { afterEach, describe, expect, it, vi } from "vitest";
import { isPwnedPassword } from "@/lib/pwned-password";

const origFetch = global.fetch;

describe("pwned password check", () => {
  afterEach(() => {
    global.fetch = origFetch;
    vi.restoreAllMocks();
  });

  it("returns false when password not found in breaches", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      new Response("00001:1\n00002:3\nABCDE:5\n", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    );
    // Password whose SHA-1 starts with FFFFF (not in the response)
    const result = await isPwnedPassword("test-password-not-pwned");
    expect(result).toBe(false);
  });

  it("returns true when password found in breaches", async () => {
    // We need a password whose SHA-1 prefix matches one in the response
    // and whose suffix matches. For testing, we mock the API to return
    // a suffix that matches.
    const hash = await crypto.subtle.digest(
      "SHA-1",
      new TextEncoder().encode("test-password-pwned"),
    );
    const hex = Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
    const prefix = hex.slice(0, 5);
    const suffix = hex.slice(5);

    global.fetch = vi.fn().mockResolvedValueOnce(
      new Response(`${suffix}:42\n`, {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    );

    // We need to mock fetch to return our suffix based on the prefix
    // of the password being tested. Since isPwnedPassword computes the
    // hash internally, we can't easily control it. Instead, test that
    // the function parses the response correctly by mocking fetch to
    // always return our suffix.
    global.fetch = vi.fn().mockImplementation((url: string) => {
      const urlPrefix = url.split("/").pop();
      if (urlPrefix === prefix) {
        return Promise.resolve(
          new Response(`${suffix}:42\n`, {
            status: 200,
            headers: { "content-type": "text/plain" },
          }),
        );
      }
      return Promise.resolve(new Response("", { status: 200 }));
    }) as typeof fetch;

    const result = await isPwnedPassword("test-password-pwned");
    expect(result).toBe(true);
  });

  it("throws on network error", async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error("network down"));
    await expect(isPwnedPassword("any-password")).rejects.toThrow(
      "network down",
    );
  });
});
