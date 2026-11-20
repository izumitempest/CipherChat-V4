import { describe, expect, it } from "vitest";
import {
  appendMessage,
  applyMarkToggle,
  MESSAGE_CAP,
  patchMessage,
  putPayload,
  removeMessage,
} from "../messages";
import type { MessageView, ReactionMark } from "@/lib/types";

function makeMessage(id: string, text = "hello"): MessageView {
  return {
    id,
    kind: "text",
    senderId: "sender-1",
    senderAlias: "Alice",
    senderColor: 0,
    self: false,
    status: "sent",
    ts: Date.now(),
    text,
  };
}

describe("appendMessage", () => {
  it("appends within cap", () => {
    const list: MessageView[] = [makeMessage("a"), makeMessage("b")];
    const next = appendMessage(list, makeMessage("c"), 5);
    expect(next.length).toBe(3);
  });

  it("drops oldest when over cap", () => {
    const list: MessageView[] = [makeMessage("a"), makeMessage("b"), makeMessage("c"), makeMessage("d"), makeMessage("e")];
    const next = appendMessage(list, makeMessage("f"), 5);
    expect(next.length).toBe(5);
    expect(next.map((m) => m.id)).toEqual(["b", "c", "d", "e", "f"]);
  });

  it("MESSAGE_CAP is 200", () => {
    expect(MESSAGE_CAP).toBe(200);
  });
});

describe("patchMessage", () => {
  it("patches matching message", () => {
    const list: MessageView[] = [makeMessage("a"), makeMessage("b")];
    const next = patchMessage(list, "b", { text: "world" });
    expect(next[1].text).toBe("world");
    expect(next[0].text).toBe("hello");
  });

  it("leaves non-matching untouched", () => {
    const list: MessageView[] = [makeMessage("a")];
    const next = patchMessage(list, "b", { text: "world" });
    expect(next).toEqual(list);
  });
});

describe("removeMessage", () => {
  it("removes matching message", () => {
    const list: MessageView[] = [makeMessage("a"), makeMessage("b"), makeMessage("c")];
    const next = removeMessage(list, "b");
    expect(next.map((m) => m.id)).toEqual(["a", "c"]);
  });

  it("leaves non-matching untouched", () => {
    const list: MessageView[] = [makeMessage("a")];
    const next = removeMessage(list, "b");
    expect(next).toEqual(list);
  });
});

describe("applyMarkToggle", () => {
  const MARKS: ReactionMark[] = ["✓", "✦", "♥", "☾"];

  it("sets a mark on a message", () => {
    const list: MessageView[] = [makeMessage("a")];
    const next = applyMarkToggle(list, "a", "sender-1", "✓");
    expect(next[0].marks).toEqual({ "✓": ["sender-1"] });
  });

  it("clears a mark when set again by same sender", () => {
    const list: MessageView[] = [{ ...makeMessage("a"), marks: { "✓": ["sender-1"] } }];
    const next = applyMarkToggle(list, "a", "sender-1", "✓");
    expect(next[0].marks).toEqual({});
  });

  it("moves mark when different mark set by same sender", () => {
    const list: MessageView[] = [{ ...makeMessage("a"), marks: { "✓": ["sender-1"] } }];
    const next = applyMarkToggle(list, "a", "sender-1", "✦");
    expect(next[0].marks).toEqual({ "✦": ["sender-1"] });
  });

  it("each sender holds at most one mark per message", () => {
    const list: MessageView[] = [{ ...makeMessage("a"), marks: { "✓": ["sender-1", "sender-2"] } }];
    const next = applyMarkToggle(list, "a", "sender-1", "✦");
    expect(next[0].marks).toEqual({ "✓": ["sender-2"], "✦": ["sender-1"] });
  });

  it("all four marks are valid", () => {
    const list: MessageView[] = [makeMessage("a")];
    let next = list;
    for (const mark of MARKS) {
      next = applyMarkToggle(next, "a", "sender-1", mark);
    }
    // Each mark clears the previous for the same sender
    const keys = Object.keys(next[0].marks ?? {});
    expect(keys).toHaveLength(1);
    expect(MARKS.includes(keys[0] as ReactionMark)).toBe(true);
  });

  it("ignores system messages", () => {
    const list: MessageView[] = [{ ...makeMessage("a"), kind: "system" }];
    const next = applyMarkToggle(list, "a", "sender-1", "✓");
    expect(next[0].marks).toBeUndefined();
  });

  it("ignores unknown message id", () => {
    const list: MessageView[] = [makeMessage("a")];
    const next = applyMarkToggle(list, "b", "sender-1", "✓");
    expect(next).toEqual(list);
  });
});

describe("putPayload", () => {
  it("stores payload within budget", () => {
    const store: Record<string, { roomId: string; dataB64: string }> = {};
    const next = putPayload(store, "room-1", "msg-1", "AAAA");
    expect(Object.keys(next).length).toBe(1);
    expect(next["msg-1"].dataB64).toBe("AAAA");
  });

  it("drops oldest file when over budget", () => {
    const store: Record<string, { roomId: string; dataB64: string }> = {};
    let next = putPayload(store, "room-1", "msg-1", "AAAA", 6);
    next = putPayload(next, "room-1", "msg-2", "BBBBBBBB", 6);
    // msg-1 (4 bytes) + msg-2 (8 bytes) = 12 > 6, so msg-1 is dropped
    expect(Object.keys(next)).toEqual(["msg-2"]);
  });

  it("never drops the message just added", () => {
    const store: Record<string, { roomId: string; dataB64: string }> = {};
    let next = putPayload(store, "room-1", "msg-1", "AAAA", 2);
    // msg-1 is 4 bytes > 2 budget, but it's the one just added so it's kept
    next = putPayload(next, "room-1", "msg-2", "BB", 2);
    expect(Object.keys(next)).toEqual(["msg-2"]);
  });
});
