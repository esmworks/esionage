"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import type { WorkspaceRole } from "@/db/schema";
import { AccessError } from "@/server/access";
import { requireUserId } from "@/server/session";
import {
  addMember,
  createWorkspace,
  removeMember,
  renameWorkspace,
  setMemberRole,
  WorkspaceError,
  type WorkspaceErrorCode,
} from "@/server/workspaces";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

// Next.js hides thrown error messages in production, so expected failures are returned instead,
// translated into the viewer's language.
async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof WorkspaceError) return fail(error.code);
    if (error instanceof AccessError) return fail("ownersOnly");
    throw error;
  }
}

async function fail(code: WorkspaceErrorCode | "ownersOnly" | "unknownRole"): Promise<{ ok: false; error: string }> {
  const t = await getTranslations("settings.errors");
  return { ok: false, error: t(code) };
}

const ROLES: WorkspaceRole[] = ["owner", "member"];
const refresh = (workspaceId: string) => revalidatePath(`/w/${workspaceId}`, "layout");

export async function createWorkspaceAction(name: string) {
  const userId = await requireUserId();
  return run(async () => (await createWorkspace(userId, name)).id);
}

export async function renameWorkspaceAction(workspaceId: string, name: string) {
  const userId = await requireUserId();
  const result = await run(() => renameWorkspace(userId, workspaceId, name));
  refresh(workspaceId);
  return result;
}

export async function addMemberAction(workspaceId: string, email: string, role: WorkspaceRole) {
  const userId = await requireUserId();
  if (!ROLES.includes(role)) return fail("unknownRole");
  const result = await run(() => addMember(userId, workspaceId, email, role));
  refresh(workspaceId);
  return result;
}

export async function setMemberRoleAction(workspaceId: string, targetId: string, role: WorkspaceRole) {
  const userId = await requireUserId();
  if (!ROLES.includes(role)) return fail("unknownRole");
  const result = await run(() => setMemberRole(userId, workspaceId, targetId, role));
  refresh(workspaceId);
  return result;
}

export async function removeMemberAction(workspaceId: string, targetId: string) {
  const userId = await requireUserId();
  const result = await run(() => removeMember(userId, workspaceId, targetId));
  refresh(workspaceId);
  return result;
}
