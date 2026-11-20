// Shared room API helpers used by both the registry and transport
// slices. Keeping them here avoids a circular import between the two
// slices.

import { encodeJoinProof, makeJoinProof } from "@/lib/join-proof";
import { getSession } from "@/lib/session";
import { roomApi } from "@/store/registry";

/** Fetch the server-assigned rotation version for a room. Returns 0
 *  when the room cannot be reached, has no versions issued yet, or
 *  the caller lacks a join proof. Zero means "use self-assignment". */
export async function fetchRoomRotationVersion(roomId: string): Promise<number> {
  try {
    const session = getSession(roomId);
    const proof = session?.joinVerifier
      ? encodeJoinProof(await makeJoinProof(session.joinVerifier, roomId))
      : null;
    const res = await fetch(roomApi(roomId, "/rotation-version"), {
      headers: proof ? { "x-join-proof": proof } : undefined,
    });
    if (!res.ok) return 0;
    const info = (await res.json().catch(() => null)) as { version?: unknown } | null;
    return typeof info?.version === "number" && Number.isFinite(info.version)
      ? info.version
      : 0;
  } catch {
    return 0;
  }
}
