"use server";

import { listInbox, markRead, unreadCount } from "@/server/notifications";
import { requireUserId } from "@/server/session";

export async function listInboxAction(workspaceId: string) {
  const userId = await requireUserId();
  return listInbox(userId, workspaceId);
}

export async function unreadCountAction(workspaceId: string) {
  const userId = await requireUserId();
  return unreadCount(userId, workspaceId);
}

/** Marks the given notifications read, or the whole inbox without ids. */
export async function markReadAction(workspaceId: string, notificationIds?: string[]) {
  const userId = await requireUserId();
  await markRead(userId, workspaceId, notificationIds);
}
