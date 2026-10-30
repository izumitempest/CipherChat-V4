// WHAT A RELAY SOCKET IS ALLOWED TO SAY
//
// Property: the relay speaks for the member id a socket claimed when
// it joined, and never for an id the client types later.
//
// The relay used to take the member id from every event: the leave,
// the typing notice, the key request. A client could announce that
// somebody else had left, which moved a live member's presence clock,
// or type under somebody else's name.
//
// See bugs/BUGS.md B32.

import { describe, it, expect } from "vitest";
import { SocketMembership } from "@/lib/relay-binding";

describe("the relay socket membership", () => {
  it("holds the member id the socket claimed at join", () => {
    const m = new SocketMembership();
    m.join("ROOM", "member-1");
    expect(m.memberIdFor("ROOM")).toBe("member-1");
  });

  it("holds nothing for a room it never joined", () => {
    const m = new SocketMembership();
    expect(m.memberIdFor("ROOM")).toBeNull();
  });

  it("the first claim in a room wins", () => {
    const m = new SocketMembership();
    m.join("ROOM", "member-1");
    m.join("ROOM", "member-2");
    expect(m.memberIdFor("ROOM")).toBe("member-1");
  });

  it("a leave drops the room", () => {
    const m = new SocketMembership();
    m.join("ROOM", "member-1");
    expect(m.leave("ROOM")).toBe("member-1");
    expect(m.memberIdFor("ROOM")).toBeNull();
    expect(m.leave("ROOM")).toBeNull();
  });

  it("rooms are independent", () => {
    const m = new SocketMembership();
    m.join("A", "member-1");
    m.join("B", "member-2");
    expect(m.memberIdFor("A")).toBe("member-1");
    expect(m.memberIdFor("B")).toBe("member-2");
    m.leave("A");
    expect(m.memberIdFor("A")).toBeNull();
    expect(m.memberIdFor("B")).toBe("member-2");
  });

  it("counts the rooms it holds", () => {
    const m = new SocketMembership();
    m.join("A", "member-1");
    m.join("B", "member-2");
    expect(m.size).toBe(2);
    expect(m.rooms().sort()).toEqual(["A", "B"]);
    m.leave("A");
    expect(m.size).toBe(1);
  });
});
