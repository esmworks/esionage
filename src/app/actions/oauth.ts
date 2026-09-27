"use server";

import { revalidatePath } from "next/cache";
import { revokeConnectedApp } from "@/server/mcp/grants";
import { requireUserId } from "@/server/session";

/** Disconnects an OAuth client: removes the user's consent and revokes its tokens. */
export async function revokeConnectedAppAction(clientId: string) {
  const userId = await requireUserId();
  await revokeConnectedApp(userId, clientId);
  revalidatePath("/account");
}
