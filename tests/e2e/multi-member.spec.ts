// Multi-member accommodation (Task 48): three real members in one
// room, and the same-browser second window that reported the bug.
//
//   part 1 — three isolated contexts (three devices): create + two
//   joins, then a full message matrix. Every member's message must
//   reach both others, attributed to one consistent, distinct alias.
//
//   part 2 — a second PAGE inside the creator's context (a second
//   window of the same browser: shared seed vault, shared storage).
//   Before the room-persona fix this tab derived the SAME identity as
//   the creator and silently re-joined as the creator's member: the
//   member count never grew and its messages were attributed to the
//   creator in every other view. Now it must join as its own member
//   with its own alias, and the creator's own view must NOT mistake
//   its messages for the creator's own.
//
// Every assertion is end-to-end: what one context encrypted, the
// others must decrypt and render under the right name.

import { test, expect, type Page } from "@playwright/test";

/** The sender nameplate rendered above a message, extracted from the
 *  Messages log: "Alias\n\nmessage text". Returns the alias line that
 *  immediately precedes the message text. */
async function nameplateAbove(page: Page, text: string): Promise<string> {
  const log = await page.locator('[aria-label="Messages"]').innerText();
  const re = new RegExp(`([A-Za-z][A-Za-z ]*[a-z])\\s+${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
  const m = re.exec(log.replace(/\n+/g, "\n"));
  if (!m) throw new Error(`no nameplate above "${text}" in log:\n${log}`);
  return m[1];
}

/** The member count the chat header shows ("N members"). */
async function memberCount(page: Page): Promise<number> {
  const header = await page
    .locator("header")
    .filter({ hasText: /\d+ members?/ })
    .first()
    .innerText();
  const m = /(\d+)\s+members?/.exec(header);
  if (!m) throw new Error(`no member count in header:\n${header}`);
  return Number(m[1]);
}

async function send(page: Page, text: string): Promise<void> {
  await page.getByLabel("Message", { exact: true }).fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
}

test("multi-member: three members, full matrix, and a same-browser second window", async ({
  browser,
}) => {
  test.setTimeout(300_000);

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const c = await ctxC.newPage();

  // ---------------- create ----------------
  await a.goto("/?app=1");
  await a.getByRole("button", { name: "Create a room" }).click();
  await a.getByPlaceholder("e.g. Trip plans").fill("Multi member");
  const passphrase = await a.locator('input[placeholder="room password"]').inputValue();
  await a.getByRole("button", { name: "Create room" }).click();
  await expect(a.getByLabel("Message", { exact: true })).toBeVisible({ timeout: 30_000 });

  const linkText = (await a.getByText(/\/\?join=/).first().textContent()) ?? "";
  const code = /join=([A-Za-z0-9]+)/.exec(linkText)?.[1];
  if (!code) throw new Error(`no room code found in invite link: ${linkText}`);
  await a.getByRole("button", { name: "Close" }).click();

  // ---------------- two joins (members B and C) ----------------
  for (const [page, label] of [
    [b, "the second member"],
    [c, "the third member"],
  ] as const) {
    await page.goto("/?app=1");
    await page.getByRole("button", { name: "Join with a link or code" }).click();
    await page.locator("#cc-join-code").fill(code);
    await page.locator("#cc-join-pass").fill(passphrase);
    await page.getByRole("button", { name: "Enter", exact: true }).click();
    await expect(page.getByLabel("Message", { exact: true })).toBeVisible({ timeout: 45_000 });
    expect(label).toBeTruthy();
  }

  // ---------------- the room knows all three ----------------
  await expect
    .poll(async () => memberCount(a), { timeout: 15_000 })
    .toBe(3);
  await expect
    .poll(async () => memberCount(b), { timeout: 15_000 })
    .toBe(3);
  await expect
    .poll(async () => memberCount(c), { timeout: 15_000 })
    .toBe(3);

  // ---------------- full message matrix ----------------
  await send(a, "first voice, member one");
  await expect(b.getByText("first voice, member one")).toBeVisible({ timeout: 15_000 });
  await expect(c.getByText("first voice, member one")).toBeVisible({ timeout: 15_000 });

  await send(b, "second voice, member two");
  await expect(a.getByText("second voice, member two")).toBeVisible({ timeout: 15_000 });
  await expect(c.getByText("second voice, member two")).toBeVisible({ timeout: 15_000 });

  await send(c, "third voice, member three");
  await expect(a.getByText("third voice, member three")).toBeVisible({ timeout: 15_000 });
  await expect(b.getByText("third voice, member three")).toBeVisible({ timeout: 15_000 });

  // ---------------- attribution: one consistent alias per member ----------------
  // B and C must agree on member one's alias; A and C on member two's;
  // A and B on member three's. All three aliases distinct.
  const aliasOne = await nameplateAbove(b, "first voice, member one");
  const aliasOneFromC = await nameplateAbove(c, "first voice, member one");
  expect(aliasOneFromC).toBe(aliasOne);

  const aliasTwo = await nameplateAbove(a, "second voice, member two");
  const aliasTwoFromC = await nameplateAbove(c, "second voice, member two");
  expect(aliasTwoFromC).toBe(aliasTwo);

  const aliasThree = await nameplateAbove(a, "third voice, member three");
  const aliasThreeFromB = await nameplateAbove(b, "third voice, member three");
  expect(aliasThreeFromB).toBe(aliasThree);

  expect(new Set([aliasOne, aliasTwo, aliasThree]).size).toBe(3);

  // A's own view renders its own words without a nameplate.
  const aLog = await a.locator('[aria-label="Messages"]').innerText();
  expect(aLog).toContain("first voice, member one");
  expect(aLog).not.toContain(`${aliasOne}\nfirst voice, member one`);

  // ---------------- the same-browser second window (the reported bug) ----------------
  // A second page in the CREATOR's context shares the seed vault and
  // all storage. Before room personas it derived the creator's
  // identity and re-joined as the creator's member. A real second
  // window arrives through the invite link.
  const a2 = await ctxA.newPage();
  await a2.goto(`/?join=${code}`);
  await a2.locator("#cc-join-pass").fill(passphrase);
  await a2.getByRole("button", { name: "Enter", exact: true }).click();
  await expect(a2.getByLabel("Message", { exact: true })).toBeVisible({ timeout: 45_000 });

  // The second window explains itself, once.
  await expect(a2.getByText(/Second window of this browser/)).toBeVisible({ timeout: 15_000 });

  // Defensive: no modal may sit over the persona's composer.
  const a2close = a2.getByRole("button", { name: "Close" });
  if (await a2close.isVisible()) await a2close.click();

  // Everyone (including the first window) now counts four members.
  await expect
    .poll(async () => memberCount(a), { timeout: 20_000 })
    .toBe(4);
  await expect
    .poll(async () => memberCount(b), { timeout: 20_000 })
    .toBe(4);
  await expect
    .poll(async () => memberCount(a2), { timeout: 20_000 })
    .toBe(4);

  // The second window speaks under its own name.
  await send(a2, "fourth voice, the second window");
  await expect(b.getByText("fourth voice, the second window")).toBeVisible({ timeout: 15_000 });
  const aliasFour = await nameplateAbove(b, "fourth voice, the second window");

  // ...and that name is NOT the creator's (the reported bug: it was).
  expect(aliasFour).not.toBe(aliasOne);
  // A distinct fourth identity, not a reuse of any member's name.
  expect(new Set([aliasOne, aliasTwo, aliasThree, aliasFour]).size).toBe(4);

  // The creator's own window does NOT mistake the second window's
  // words for its own: they render with a nameplate (someone else),
  // while the creator's own earlier words still render bare.
  const aliasFourInA = await nameplateAbove(a, "fourth voice, the second window");
  expect(aliasFourInA).toBe(aliasFour);

  // The second window also hears the room: member two's words arrive.
  await send(b, "fifth voice, back to member two");
  await expect(a2.getByText("fifth voice, back to member two")).toBeVisible({ timeout: 15_000 });
  const aliasTwoInA2 = await nameplateAbove(a2, "fifth voice, back to member two");
  expect(aliasTwoInA2).toBe(aliasTwo);

  // ---------------- persona stickiness across a refresh ----------------
  // The second window reloads: keys are memory-only, so the room
  // locks; its persona nonce lives in sessionStorage (per-tab), so
  // after unlocking it must return under the SAME identity, not the
  // creator's and not a fresh one.
  await a2.reload();
  await a2.locator("#cc-locked-pass").fill(passphrase);
  await a2.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(a2.getByLabel("Message", { exact: true })).toBeVisible({ timeout: 45_000 });
  await send(a2, "sixth voice, the second window after reload");
  await expect(b.getByText("sixth voice, the second window after reload")).toBeVisible({
    timeout: 15_000,
  });
  const aliasFourAfterReload = await nameplateAbove(
    b,
    "sixth voice, the second window after reload",
  );
  expect(aliasFourAfterReload).toBe(aliasFour);

  // ---------------- cleanup ----------------
  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});
