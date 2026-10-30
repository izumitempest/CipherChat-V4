// The message bubble, rendered. The rules here are the ones a reader
// would notice if they broke: the file card says when the bytes are
// gone, and the countdown speaks once instead of every second.
//
// The renders are static (react-dom/server): no browser, no effects.
// What is under test is the markup, not the interaction. The store is
// mocked, because a server render reads the store's first snapshot and
// nothing else; the store's own rules have their own tests.

import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/** The store, as the component sees it: the parts the bubble reads. */
const storeState = {
  activeRoomId: null as string | null,
  members: {} as Record<string, unknown[]>,
  filePayloads: {} as Record<string, { roomId: string; dataB64: string }>,
  reactToMessage: () => {},
};

vi.mock("@/store/app", () => ({
  useApp: (selector: (s: typeof storeState) => unknown) => selector(storeState),
}));

const { MessageBubble } = await import("@/components/cc/bubble");
type MessageView = import("@/lib/types").MessageView;

const POSITION = { first: true, last: true, showTime: true };

function fileMessage(): MessageView {
  return {
    id: "m-file",
    kind: "file",
    senderId: "m-1",
    senderAlias: "Someone",
    status: "sent",
    ts: 1_700_000_000_000,
    file: { name: "note.txt", mime: "text/plain", size: 12 },
  };
}

function imageMessage(): MessageView {
  return {
    id: "m-image",
    kind: "file",
    senderId: "m-1",
    senderAlias: "Someone",
    status: "sent",
    ts: 1_700_000_000_000,
    file: { name: "photo.jpg", mime: "image/jpeg", size: 2048 },
  };
}

function render(message: MessageView): string {
  return renderToStaticMarkup(
    createElement(MessageBubble, {
      message,
      position: POSITION,
      onOpenFile: () => {},
    }),
  );
}

describe("the file card", () => {
  it("an image card renders the image from the payload store", () => {
    storeState.filePayloads = { "m-image": { roomId: "ROOM", dataB64: "QUJD" } };
    const html = render(imageMessage());
    expect(html).toContain("View image photo.jpg");
    expect(html).toContain("data:image/jpeg;base64,QUJD");
  });

  it("an image card says the contents are gone when the bytes are not", () => {
    storeState.filePayloads = {};
    const html = render(imageMessage());
    expect(html).toContain("contents are no longer here");
    expect(html).toContain("photo.jpg");
  });

  it("a file card names the file whatever the bytes do", () => {
    storeState.filePayloads = {};
    const html = render(fileMessage());
    expect(html).toContain("note.txt");
    expect(html).toContain("Open file note.txt in the viewer");
  });
});

describe("the countdown", () => {
  it("speaks once, and keeps the ticking number out of the live region", () => {
    const message: MessageView = {
      id: "m-ttl",
      kind: "text",
      senderId: "m-1",
      senderAlias: "Someone",
      status: "sent",
      ts: Date.now(),
      text: "this one burns",
      ttlSec: 60,
      expiresAt: Date.now() + 30_000,
    };
    const html = render(message);
    // The ticking label is out of the live region...
    expect(html).toContain('aria-live="off"');
    // ...and the sentence inside it is the one that says the time.
    expect(html).toContain("About a minute left before this message burns");
  });

  it("says nothing about the time when there is plenty of it", () => {
    const message: MessageView = {
      id: "m-ttl2",
      kind: "text",
      senderId: "m-1",
      senderAlias: "Someone",
      status: "sent",
      ts: Date.now(),
      text: "this one burns",
      ttlSec: 600,
      expiresAt: Date.now() + 600_000,
    };
    const html = render(message);
    expect(html).not.toContain("before this message burns");
  });
});
