// The golden path — the whole product in one conversation.
//
// Two browser contexts, same origin (isolated storage — the reason
// this could never be two tabs): creator A and member B walk the full
// lifecycle the Task 32 spec names:
//
//   create → join → message → reply → react → GPS-JPEG through the
//   EXIF strip (byte-verified in the receiver's viewer) → view-once
//   (opened, no download, spent propagates) → leave → rotation →
//   rejoin (fresh joiner sees no history, but the room lives and the
//   rotated key delivers) → burn (both ends run the burn sequence).
//
// Every assertion is end-to-end: what one context sealed, the other
// must decrypt and render.

import { test, expect, type Page } from "@playwright/test";
import { buildGpsJpeg, readCleanJpeg } from "./fixtures/gps-jpeg";

/** Byte-level EXIF scan of the blob the RECEIVER's viewer is rendering:
 *  proves the strip survived the whole pipeline (attach → re-encode →
 *  seal → relay → open → viewer), not just the attach step. */
async function scanRenderedImage(page: Page): Promise<{ isJpeg: boolean; hasExifApp1: boolean }> {
  const src = await page.locator('img[src^="blob:"]').first().getAttribute("src");
  if (!src) throw new Error("no blob: image rendered in the viewer");
  return page.evaluate(async (url: string) => {
    const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
    let hasExifApp1 = false;
    if (isJpeg) {
      let i = 2;
      while (i + 4 <= buf.length) {
        if (buf[i] !== 0xff) break;
        const marker = buf[i + 1];
        const len = (buf[i + 2] << 8) | buf[i + 3];
        if (marker === 0xe1) {
          const tag = String.fromCharCode(...buf.slice(i + 4, i + 10));
          if (tag === "Exif\u0000\u0000") hasExifApp1 = true;
        }
        if (marker === 0xda) break; // start of scan — no more metadata segments
        i += 2 + len;
      }
    }
    return { isJpeg, hasExifApp1 };
  }, src);
}

test("golden path: create → join → message → reply → react → EXIF strip → view-once → leave/rotation → rejoin → burn", async ({
  browser,
}) => {
  test.setTimeout(300_000);

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  // ---------------- create ----------------
  await a.goto("/?app=1"); // the portfolio fronts /; the product lives one param in
  await a.getByRole("button", { name: "Create a room" }).click();
  await a.getByPlaceholder("e.g. Trip plans").fill("Golden path");
  const passphrase = await a.locator('input[placeholder="room password"]').inputValue();
  // The six-word default (2^48), live in the running stack.
  expect(passphrase.split("-")).toHaveLength(6);
  await a.getByRole("button", { name: "Create room" }).click();
  await expect(a.getByLabel("Message", { exact: true })).toBeVisible({ timeout: 30_000 });

  // ---------------- the room code, via the invite sheet ----------------
  // The invite sheet opens itself after creation — the creator's next
  // step is sharing. The link box carries ?join=CODE; the password is
  // masked and we already hold it from the create sheet.
  const linkText = (await a.getByText(/\/\?join=/).first().textContent()) ?? "";
  const code = /join=([A-Za-z0-9]+)/.exec(linkText)?.[1];
  if (!code) throw new Error(`no room code found in invite link: ${linkText}`);
  await a.getByRole("button", { name: "Close" }).click();
  await expect(a.getByText(/\/\?join=/)).toBeHidden();

  // ---------------- join ----------------
  await b.goto("/?app=1");
  await b.getByRole("button", { name: "Join with a link or code" }).click();
  await b.locator("#cc-join-code").fill(code);
  await b.locator("#cc-join-pass").fill(passphrase);
  await b.getByRole("button", { name: "Enter", exact: true }).click();
  await expect(b.getByLabel("Message", { exact: true })).toBeVisible({ timeout: 45_000 }); // argon2id 64MB + join

  // ---------------- message ----------------
  await a.getByLabel("Message", { exact: true }).fill("first letter");
  await a.getByLabel("Send message").click();
  await expect(b.getByText("first letter")).toBeVisible({ timeout: 15_000 });
  await b.getByLabel("Message", { exact: true }).fill("answer from the guest");
  await b.getByLabel("Send message").click();
  await expect(a.getByText("answer from the guest")).toBeVisible({ timeout: 15_000 });

  // ---------------- reply (context menu on the quoted message) ----------------
  await b.getByText("first letter").first().click({ button: "right" });
  await b.getByRole("menuitem", { name: "Reply", exact: true }).click();
  await expect(b.getByLabel("Cancel reply")).toBeVisible();
  await b.getByLabel("Message", { exact: true }).fill("a reply arrives");
  await b.getByLabel("Send message").click();
  await expect(a.getByText("a reply arrives")).toBeVisible({ timeout: 15_000 });
  // The quote rides along: the snippet appears on A's side too.
  await expect(a.getByText("first letter", { exact: true })).toHaveCount(2, { timeout: 15_000 });

  // ---------------- react (context menu → mark) ----------------
  await b.getByText("first letter").first().click({ button: "right" });
  await b.getByRole("menuitem", { name: "Mark this message" }).hover();
  await b.getByRole("menuitem", { name: /Acknowledged/ }).click();
  // The mark chip reaches the OTHER context.
  await expect(a.getByText("✓").first()).toBeVisible({ timeout: 15_000 });

  // ---------------- GPS JPEG through the EXIF strip ----------------
  await a.setInputFiles('input[type="file"]', {
    name: "gps.jpg",
    mimeType: "image/jpeg",
    buffer: buildGpsJpeg(),
  });
  // The slip appears once the re-encode finishes (fail-closed: a file
  // that cannot be stripped is refused, never sent).
  await expect(a.getByLabel("Remove attachment")).toBeVisible({ timeout: 15_000 });
  await a.getByLabel("Message", { exact: true }).fill("a photo with a past");
  await a.getByLabel("Send message").click();
  await expect(b.getByLabel(/View image gps\.jpg/)).toBeVisible({ timeout: 20_000 });
  await b.getByLabel(/View image gps\.jpg/).click();
  await expect(b.locator('img[src^="blob:"]').first()).toBeVisible({ timeout: 10_000 });
  const verdict = await scanRenderedImage(b);
  expect(verdict.isJpeg).toBe(true);
  expect(verdict.hasExifApp1).toBe(false); // the return address did not survive
  await b.getByLabel("Close viewer").click();

  // ---------------- view-once ----------------
  await a.setInputFiles('input[type="file"]', {
    name: "once.jpg",
    mimeType: "image/jpeg",
    buffer: readCleanJpeg(),
  });
  await expect(a.getByLabel("Remove attachment")).toBeVisible({ timeout: 15_000 });
  await a.getByRole("button", { name: "View once" }).click();
  await a.getByLabel("Send message").click();
  const sealed = b.getByLabel("Open sealed file — it can be opened once");
  await expect(sealed).toBeVisible({ timeout: 20_000 });
  await sealed.click();
  await expect(b.locator('img[src^="blob:"]').first()).toBeVisible({ timeout: 10_000 });
  // No download for a view-once file — from anyone, by design.
  await expect(b.getByLabel("Download a copy")).toHaveCount(0);
  await b.getByLabel("Close viewer").click();
  // Spent propagates to both ends.
  await expect(b.getByLabel(/Open sealed file/)).toBeHidden({ timeout: 15_000 });
  await expect(a.getByLabel(/Open sealed file/)).toBeHidden({ timeout: 15_000 });

  // ---------------- leave → rotation ----------------
  await b.getByLabel("Room settings").click();
  await b.getByRole("button", { name: "Leave room" }).click();
  // B is out: the card leaves B's rail and B's composer is gone (the
  // desktop desk keeps the rail visible, so "back at the desk" is
  // asserted on what actually changes, not on the rail itself).
  await expect(b.getByLabel("Message", { exact: true })).toBeHidden({ timeout: 20_000 });
  await expect(b.getByRole("button", { name: /Golden path/ })).toBeHidden({ timeout: 20_000 });
  // A is told, the room rotates under a new key, and A stays functional.
  await expect(a.locator("body")).toContainText(/left\b/, { timeout: 20_000 });
  await a.getByLabel("Message", { exact: true }).fill("still here after the rotation");
  await a.getByLabel("Send message").click();
  await expect(a.getByText("still here after the rotation")).toBeVisible({ timeout: 15_000 });

  // ---------------- rejoin ----------------
  await b.goto("/?app=1"); // no rooms left → landing
  await b.getByRole("button", { name: "Join with a link or code" }).click();
  await b.locator("#cc-join-code").fill(code);
  await b.locator("#cc-join-pass").fill(passphrase);
  await b.getByRole("button", { name: "Enter", exact: true }).click();
  await expect(b.getByLabel("Message", { exact: true })).toBeVisible({ timeout: 45_000 });
  // A fresh joiner sees nothing from before they joined — by construction.
  await expect(b.getByText("first letter")).toHaveCount(0);
  // ...but the room lives, and the ROTATED key delivers:
  await b.getByLabel("Message", { exact: true }).fill("returned");
  await b.getByLabel("Send message").click();
  await expect(a.getByText("returned", { exact: true })).toBeVisible({ timeout: 20_000 });

  // ---------------- burn ----------------
  await a.getByLabel("Room settings").click();
  await a.getByRole("button", { name: "Burn this room" }).click();
  await a.getByRole("button", { name: "Burn the room" }).click();
  // Both ends run the burn sequence (the relay announces room:burned):
  // the room card disappears and the composer closes on each.
  await expect(a.getByRole("button", { name: /Golden path/ })).toBeHidden({ timeout: 30_000 });
  await expect(a.getByLabel("Message", { exact: true })).toBeHidden({ timeout: 30_000 });
  await expect(b.getByRole("button", { name: /Golden path/ })).toBeHidden({ timeout: 30_000 });
  await expect(b.getByLabel("Message", { exact: true })).toBeHidden({ timeout: 30_000 });

  await ctxA.close();
  await ctxB.close();
});
