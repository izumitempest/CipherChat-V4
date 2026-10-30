// The store's wiring. The store is assembled from slices now, so the
// risk is a slice that forgets an action: the state would name it and
// the store would not have it, and the first call would be a crash in
// the room, not a red test.
//
// This test walks the state and checks that every action is there.

import { describe, expect, it } from "vitest";
import { useApp } from "@/store/app";

/** Every action the state names. Kept by hand on purpose: a slice
 *  that adds an action has to add it here too, and a slice that
 *  drops one fails this test. */
const ACTIONS = [
  "init",
  "navigate",
  "syncHash",
  "createRoom",
  "joinRoom",
  "enterRoom",
  "adjustRoomTtl",
  "closeExpiredRoom",
  "sendMessage",
  "emitTyping",
  "spendViewOnce",
  "reactToMessage",
  "burnMessage",
  "burnRoom",
  "finishRoomBurn",
  "leaveRoom",
  "renameRoom",
  "panicLock",
  "setCoverTraffic",
  "setDefaultTtl",
  "markVerified",
  "isVerified",
  "refreshMembers",
] as const;

describe("the store", () => {
  it("has every action the state names", () => {
    const state = useApp.getState();
    for (const name of ACTIONS) {
      expect(typeof state[name], name).toBe("function");
    }
  });

  it("starts empty, with no room in it", () => {
    const state = useApp.getState();
    expect(state.ready).toBe(false);
    expect(state.activeRoomId).toBeNull();
    expect(state.messages).toEqual({});
    expect(state.filePayloads).toEqual({});
    expect(state.members).toEqual({});
    expect(state.typing).toEqual({});
    expect(state.relayOnline).toBe(false);
  });
});
