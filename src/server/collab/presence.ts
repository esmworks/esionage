import { PRESENCE_FIELD, type Presence } from "@/lib/presence";

/**
 * Rewrites the presence in awareness states coming from a connection to the identity it signed in
 * with. A state without presence keeps none; without a signed-in user the presence is dropped.
 */
export function stampPresence(
  states: Map<number, Record<string, unknown>>,
  signedIn: { userId?: string; userName?: string; userImage?: string | null } | undefined,
) {
  for (const state of states.values()) {
    if (!state || state[PRESENCE_FIELD] == null) continue;
    if (signedIn?.userId) {
      state[PRESENCE_FIELD] = {
        id: signedIn.userId,
        name: signedIn.userName ?? "",
        ...(signedIn.userImage ? { image: signedIn.userImage } : {}),
      } satisfies Presence;
    } else delete state[PRESENCE_FIELD];
  }
}
