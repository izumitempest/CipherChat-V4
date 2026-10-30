// What a relay socket is allowed to say.
//
// The relay used to take the member id from every event the client
// sent: the leave, the typing notice, the key request. A client could
// announce that somebody else had left, or type under somebody else's
// name, or ask for a key as somebody else.
//
// The relay now binds a socket to the member ids it claimed at JOIN
// time, and every later event speaks for the bound id. The client's
// own id is ignored.
//
// Pure, so the property is testable without a live relay.

export class SocketMembership {
  /** roomId -> the member id this socket holds there. */
  private readonly bound = new Map<string, string>();

  /** The socket claims a member id in a room. The first claim wins:
   *  a socket cannot swap ids inside a room it already holds. */
  join(roomId: string, memberId: string): void {
    if (!this.bound.has(roomId)) this.bound.set(roomId, memberId);
  }

  /** The member id this socket holds for a room, or null. */
  memberIdFor(roomId: string): string | null {
    return this.bound.get(roomId) ?? null;
  }

  /** Drop the room. Returns the member id that was held, or null. */
  leave(roomId: string): string | null {
    const held = this.bound.get(roomId) ?? null;
    this.bound.delete(roomId);
    return held;
  }

  /** The rooms this socket holds. */
  rooms(): string[] {
    return Array.from(this.bound.keys());
  }

  get size(): number {
    return this.bound.size;
  }
}
