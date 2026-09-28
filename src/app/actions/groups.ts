"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import type { ActionResult } from "@/app/actions/workspaces";
import { AccessError } from "@/server/access";
import {
  addGroupMembers,
  createGroup,
  deleteGroup,
  GroupError,
  type GroupErrorCode,
  removeGroupMember,
  renameGroup,
} from "@/server/groups";
import { requireUserId } from "@/server/session";

// Expected failures come back translated: Next.js hides thrown messages in production.
async function run<T>(workspaceId: string, fn: (userId: string) => Promise<T>): Promise<ActionResult<T>> {
  const userId = await requireUserId();
  try {
    const data = await fn(userId);
    // Settings, the members list and sidebars show groups and what they give.
    revalidatePath(`/w/${workspaceId}`, "layout");
    return { ok: true, data };
  } catch (error) {
    if (error instanceof GroupError) return fail(error.code);
    if (error instanceof AccessError) return fail("accessDenied");
    throw error;
  }
}

async function fail(code: GroupErrorCode | "accessDenied"): Promise<{ ok: false; error: string }> {
  const t = await getTranslations("settings.groups.errors");
  return { ok: false, error: t(code) };
}

const ids = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];

export async function createGroupAction(workspaceId: string, name: string, userIds: string[] = []) {
  return run(workspaceId, async (userId) => (await createGroup(userId, workspaceId, String(name ?? ""), ids(userIds))).id);
}

export async function renameGroupAction(workspaceId: string, groupId: string, name: string) {
  return run(workspaceId, (userId) => renameGroup(userId, groupId, String(name ?? "")));
}

export async function deleteGroupAction(workspaceId: string, groupId: string) {
  return run(workspaceId, (userId) => deleteGroup(userId, groupId));
}

export async function addGroupMembersAction(workspaceId: string, groupId: string, userIds: string[]) {
  return run(workspaceId, (userId) => addGroupMembers(userId, groupId, ids(userIds)));
}

export async function removeGroupMemberAction(workspaceId: string, groupId: string, targetId: string) {
  return run(workspaceId, (userId) => removeGroupMember(userId, groupId, targetId));
}
