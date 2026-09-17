// Task 25 — notifications: what a notice says, and where it goes.
// The pure half of lib/notifications (formatting + channel decision
// + preferences' failure modes). The browser half (service worker,
// Notification API) is exercised end-to-end, not here.

import { describe, expect, it } from "vitest";
import {
  NOTIFY_PREVIEW_DEFAULT,
  bannerLine,
  clampBadgeCount,
  decideNoticeChannel,
  describeNotice,
  loadNotifyPreview,
  type IncomingNotice,
} from "../notifications";

const base: IncomingNotice = {
  roomId: "r1",
  roomName: "Trip plans",
  alias: "Quiet Heron",
  colorIdx: 3,
  text: "Meet at the pier at noon",
};

describe("decideNoticeChannel", () => {
  it("says nothing when the user is already reading the room", () => {
    expect(decideNoticeChannel({ hidden: false, inRoom: true })).toBe("none");
    expect(decideNoticeChannel({ hidden: true, inRoom: true })).toBe("none");
  });

  it("rises as a banner while the app is open elsewhere", () => {
    expect(decideNoticeChannel({ hidden: false, inRoom: false })).toBe("banner");
  });

  it("goes native when the app is hidden", () => {
    expect(decideNoticeChannel({ hidden: true, inRoom: false })).toBe("native");
  });
});

describe("describeNotice", () => {
  it("full text under the content preference", () => {
    expect(describeNotice(base, "content")).toEqual({
      title: "Trip plans",
      body: "Quiet Heron: Meet at the pier at noon",
    });
  });

  it("sender only under the sender preference", () => {
    expect(describeNotice(base, "sender")).toEqual({
      title: "Trip plans",
      body: "Quiet Heron sent a letter",
    });
  });

  it("files are named, never shown", () => {
    expect(describeNotice({ ...base, isFile: true }, "content")).toEqual({
      title: "Trip plans",
      body: "Quiet Heron sent a file",
    });
    expect(describeNotice({ ...base, isFile: true, text: null }, "sender")).toEqual({
      title: "Trip plans",
      body: "Quiet Heron sent a file",
    });
  });

  it("a file caption is treated as file, not letter text", () => {
    expect(describeNotice({ ...base, isFile: true, text: "the tickets" }, "content")).toEqual({
      title: "Trip plans",
      body: "Quiet Heron sent a file",
    });
  });

  it("nothing is revealed under the none preference", () => {
    expect(describeNotice(base, "none")).toEqual({
      title: "Trip plans",
      body: "A new letter arrived",
    });
    expect(describeNotice({ ...base, isFile: true }, "none")).toEqual({
      title: "Trip plans",
      body: "A file arrived",
    });
  });

  it("collapses whitespace and truncates long letters to 140 chars", () => {
    const long = "word ".repeat(60); // 300 chars
    const { body } = describeNotice({ ...base, text: long }, "content");
    const text = body.slice("Quiet Heron: ".length);
    expect(text.length).toBeLessThanOrEqual(140);
    expect(text.endsWith("…")).toBe(true);
    expect(text).not.toContain("\n");
  });

  it("falls back to a letter announcement when content is preferred but absent", () => {
    expect(describeNotice({ ...base, text: null }, "content")).toEqual({
      title: "Trip plans",
      body: "Quiet Heron sent a letter",
    });
  });

  it("an unnamed room still has a title", () => {
    expect(describeNotice({ ...base, roomName: "" }, "none").title).toBe("CipherChat");
  });
});

describe("bannerLine", () => {
  it("shows the text under content", () => {
    expect(bannerLine(base, "content")).toBe("Meet at the pier at noon");
  });

  it("names only the act under sender", () => {
    expect(bannerLine(base, "sender")).toBe("Sent a letter");
    expect(bannerLine({ ...base, isFile: true }, "sender")).toBe("Sent a file");
  });

  it("says only that a letter arrived under none", () => {
    expect(bannerLine(base, "none")).toBe("A new letter arrived");
  });
});

describe("preferences", () => {
  it("defaults to sender (the brand keeps its mouth shut until asked)", () => {
    expect(NOTIFY_PREVIEW_DEFAULT).toBe("sender");
    // No localStorage in this environment — the guarded read must
    // still answer with the default.
    expect(loadNotifyPreview()).toBe("sender");
  });
});

describe("badge clamp", () => {
  it("caps at 99 and floors at 0", () => {
    expect(clampBadgeCount(0)).toBe(0);
    expect(clampBadgeCount(42)).toBe(42);
    expect(clampBadgeCount(99)).toBe(99);
    expect(clampBadgeCount(1000)).toBe(99);
    expect(clampBadgeCount(-5)).toBe(0);
  });
});
