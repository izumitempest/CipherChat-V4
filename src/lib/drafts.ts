// Per-room composer drafts, memory-only like the keys. A message in
// progress stays with its room across room switches and returns when
// the room is reopened; a refresh wipes it with everything else
// (memory-only is deliberate, not a bug).

const drafts = new Map<string, string>();

export function getDraft(roomId: string): string {
  return drafts.get(roomId) ?? "";
}

export function setDraft(roomId: string, text: string): void {
  if (text.trim().length > 0) drafts.set(roomId, text);
  else drafts.delete(roomId);
}

export function dropDraft(roomId: string): void {
  drafts.delete(roomId);
}
