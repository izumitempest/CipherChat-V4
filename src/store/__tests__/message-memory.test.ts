// The message memory's rules, held to account.
//
// The list, the payload store and the mark toggle are pure functions
// over plain data: they are the rules that keep a long room bounded,
// and a test is the only thing that holds a rule to account.

import { describe, expect, it } from "vitest";
import {
  FILE_PAYLOAD_BUDGET,
  MESSAGE_CAP,
  applyMarkToggle,
  appendMessage,
  appendToRoom,
  clearRoomPayloads,
  dropPayload,
  patchMessage,
  putPayload,
  removeMessage,
  type PayloadStore,
} from "@/store/messages";
import type { MessageView } from "@/lib/types";

function letter(id: string, text = "hello"): MessageView {
  return {
    id,
    kind: "text",
    senderId: "m-1",
    senderAlias: "Someone",
    status: "sent",
    ts: 1_700_000_000_000,
    text,
  };
}

function fileLetter(id: string, name = "note.txt"): MessageView {
  return {
    id,
    kind: "file",
    senderId: "m-1",
    senderAlias: "Someone",
    status: "sent",
    ts: 1_700_000_000_000,
    file: { name, mime: "text/plain", size: 12 },
  };
}

/** A stand-in for the store's set: a plain object with the two
 *  methods the helpers use. */
function fakeStore(initial: {
  messages?: Record<string, MessageView[]>;
  filePayloads?: PayloadStore;
} = {}) {
  const state = {
    messages: initial.messages ?? {},
    filePayloads: initial.filePayloads ?? {},
  };
  const set = (partial: unknown) => {
    const next =
      typeof partial === "function"
        ? (partial as (s: typeof state) => Partial<typeof state>)(state)
        : (partial as Partial<typeof state>);
    Object.assign(state, next);
  };
  return { state, set: set as never };
}

describe("the message list", () => {
  it("keeps the newest letters and drops the oldest at the cap", () => {
    let list: MessageView[] = [];
    for (let i = 0; i < MESSAGE_CAP + 25; i++) {
      list = appendMessage(list, letter(`m-${i}`));
    }
    expect(list).toHaveLength(MESSAGE_CAP);
    expect(list[0].id).toBe("m-25");
    expect(list[list.length - 1].id).toBe(`m-${MESSAGE_CAP + 24}`);
  });

  it("a list under the cap grows untouched", () => {
    const list = appendMessage([letter("a")], letter("b"));
    expect(list.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("patches one letter and leaves the rest alone", () => {
    const list = patchMessage([letter("a"), letter("b")], "a", { status: "burning" });
    expect(list[0].status).toBe("burning");
    expect(list[1].status).toBe("sent");
  });

  it("takes a letter out", () => {
    const list = removeMessage([letter("a"), letter("b")], "a");
    expect(list.map((m) => m.id)).toEqual(["b"]);
  });
});

describe("the file payloads", () => {
  it("keeps the bytes out of the message and finds them by message id", () => {
    const store = putPayload({}, "ROOM", "m-1", "AAAA");
    expect(store["m-1"].dataB64).toBe("AAAA");
    expect(store["m-1"].roomId).toBe("ROOM");
  });

  it("drops the oldest file when the room's budget is reached", () => {
    const budget = 100;
    let store: PayloadStore = {};
    store = putPayload(store, "ROOM", "old", "A".repeat(60), budget);
    store = putPayload(store, "ROOM", "new", "B".repeat(60), budget);
    // The room now holds more than the budget: the oldest file goes.
    expect(store["old"]).toBeUndefined();
    expect(store["new"]).toBeDefined();
  });

  it("never drops the file that just arrived", () => {
    const budget = 10;
    const store = putPayload({}, "ROOM", "only", "A".repeat(100), budget);
    expect(store["only"]).toBeDefined();
  });

  it("counts the budget per room, not across the whole app", () => {
    const budget = 100;
    let store: PayloadStore = {};
    store = putPayload(store, "ROOM-A", "a", "A".repeat(60), budget);
    store = putPayload(store, "ROOM-B", "b", "B".repeat(60), budget);
    expect(store["a"]).toBeDefined();
    expect(store["b"]).toBeDefined();
  });

  it("takes a file's bytes out when its letter burns", () => {
    const store = putPayload({}, "ROOM", "m-1", "AAAA");
    expect(dropPayload(store, "ROOM", "m-1")["m-1"]).toBeUndefined();
  });

  it("clears a room's files and leaves the other rooms alone", () => {
    let store: PayloadStore = {};
    store = putPayload(store, "ROOM-A", "a", "AAAA");
    store = putPayload(store, "ROOM-B", "b", "BBBB");
    const cleared = clearRoomPayloads(store, "ROOM-A");
    expect(cleared["a"]).toBeUndefined();
    expect(cleared["b"]).toBeDefined();
  });

  it("the default budget is a room's worth of big files", () => {
    expect(FILE_PAYLOAD_BUDGET).toBe(32 * 1024 * 1024);
  });
});

describe("a letter that falls off the cap", () => {
  it("takes its file with it", () => {
    const { state, set } = fakeStore({
      messages: { ROOM: [fileLetter("old")] },
      filePayloads: putPayload({}, "ROOM", "old", "AAAA"),
    });
    // Fill the room to the cap, then add one more.
    const full = Array.from({ length: MESSAGE_CAP }, (_, i) => letter(`m-${i}`));
    state.messages.ROOM = full;
    appendToRoom(set as never, "ROOM", fileLetter("new"), "BBBB");
    expect(state.messages.ROOM).toHaveLength(MESSAGE_CAP);
    expect(state.messages.ROOM[0].id).toBe("m-1");
    expect(state.filePayloads["new"]).toBeDefined();
    // The old file's message is gone, so its bytes go too.
    expect(state.filePayloads["old"]).toBeUndefined();
  });
});

describe("the ink marks", () => {
  it("sets a mark, and clears it when it is set again", () => {
    let list = applyMarkToggle([letter("a")], "a", "m-1", "✓");
    expect(list[0].marks?.["✓"]).toEqual(["m-1"]);
    list = applyMarkToggle(list, "a", "m-1", "✓");
    expect(list[0].marks?.["✓"]).toBeUndefined();
  });

  it("moves a mark from one glyph to another", () => {
    let list = applyMarkToggle([letter("a")], "a", "m-1", "✓");
    list = applyMarkToggle(list, "a", "m-1", "✦");
    expect(list[0].marks?.["✓"]).toBeUndefined();
    expect(list[0].marks?.["✦"]).toEqual(["m-1"]);
  });

  it("holds one mark per sender, and leaves the other senders alone", () => {
    let list = applyMarkToggle([letter("a")], "a", "m-1", "✓");
    list = applyMarkToggle(list, "a", "m-2", "✓");
    expect(list[0].marks?.["✓"]).toEqual(["m-1", "m-2"]);
  });

  it("never marks a system line", () => {
    const line: MessageView = {
      id: "s",
      kind: "system",
      status: "sent",
      ts: 1,
      text: "Someone left.",
    };
    const list = applyMarkToggle([line], "s", "m-1", "✓");
    expect(list[0].marks).toBeUndefined();
  });
});
