"use server";

import { setAssignmentEmailsEnabled } from "@/server/assignments";
import { requireUserId } from "@/server/session";

/** Turns the signed-in user's assignment emails on or off, on every device. */
export async function setAssignmentEmailsAction(on: boolean) {
  const userId = await requireUserId();
  await setAssignmentEmailsEnabled(userId, on);
}
