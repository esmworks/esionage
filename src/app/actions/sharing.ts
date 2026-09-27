"use server";

import { revalidatePath } from "next/cache";
import type { PageLevel } from "@/db/schema";
import { AccessError, resolvePageAccess } from "@/server/access";
import { getCollab } from "@/server/collab/bridge";
import {
  listPagePermissions,
  PermissionError,
  removePageInvitation,
  removePagePermission,
  setPagePermission,
  sharePageByEmail,
  type ShareByEmailResult,
} from "@/server/permissions";
import { requireUserId } from "@/server/session";
import { listMembers } from "@/server/workspaces";

export type SharingErrorCode = "notMember" | "lastFullAccess" | "invalidEmail" | "ownersOnly" | "accessDenied" | "generic";
export type SharingResult<T = unknown> = { ok: true; data?: T } | { ok: false; code: SharingErrorCode };

/** Who the page is shared with, plus the workspace members it can be shared with. */
export async function getSharingAction(pageId: string) {
  const userId = await requireUserId();
  const { page: target, level } = await resolvePageAccess(userId, pageId);
  if (!target || level === "none") throw new AccessError();
  const [permissions, members] = await Promise.all([
    listPagePermissions(userId, pageId),
    // Guests can't see who is in the workspace, so they get no one to pick from.
    listMembers(userId, target.workspaceId).catch((error) => {
      if (error instanceof AccessError) return [];
      throw error;
    }),
  ]);
  return {
    ...permissions,
    members: members.map((m) => ({ userId: m.userId, name: m.name, email: m.email, role: m.role })),
  };
}

async function change<T>(
  pageId: string,
  run: (userId: string) => Promise<T>,
): Promise<SharingResult<T>> {
  const userId = await requireUserId();
  let data: T;
  try {
    data = await run(userId);
  } catch (error) {
    if (error instanceof PermissionError) return { ok: false, code: error.code };
    if (error instanceof AccessError) return { ok: false, code: "accessDenied" };
    console.error("[sharing action]", error);
    return { ok: false, code: "generic" };
  }
  const { page: target } = await resolvePageAccess(userId, pageId);
  if (target) {
    // Sidebars refetch the tree, since what a member can see may have changed.
    getCollab().broadcast(`ws:${target.workspaceId}`, "tree");
    revalidatePath(`/w/${target.workspaceId}`, "layout");
  }
  return { ok: true, data };
}

/** `principal` is a member's user id, or null for everyone in the workspace. */
export async function setPagePermissionAction(pageId: string, principal: string | null, level: PageLevel) {
  return change(pageId, (userId) => setPagePermission(userId, pageId, principal, level));
}

export async function removePagePermissionAction(pageId: string, principal: string | null) {
  return change(pageId, (userId) => removePagePermission(userId, pageId, principal));
}

/** Shares the page with an email address: a member, an account to add as a guest, or an invitation. */
export async function sharePageByEmailAction(pageId: string, email: string, level: Exclude<PageLevel, "none">) {
  return change<ShareByEmailResult>(pageId, (userId) => sharePageByEmail(userId, pageId, email, level));
}

export async function removePageInvitationAction(pageId: string, email: string) {
  return change(pageId, (userId) => removePageInvitation(userId, pageId, email));
}
