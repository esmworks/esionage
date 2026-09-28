"use server";

import { revalidateAccountPages } from "@/server/account-pages";
import { revokeConnectedApp } from "@/server/mcp/grants";
import { requireUserId } from "@/server/session";

/** Disconnects an OAuth client: removes the user's consent and revokes its tokens. */
export async function revokeConnectedAppAction(clientId: string) {
  const userId = await requireUserId();
  await revokeConnectedApp(userId, clientId);
  revalidateAccountPages();
}
