"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import type { WorkspaceRole, WorkspaceSettings } from "@/db/schema";
import { isStrongSession } from "@/lib/auth-security";
import { AccessError } from "@/server/access";
import { revokeFormPublication } from "@/server/forms";
import { revokePublication } from "@/server/publication";
import { getSession, requireUserId } from "@/server/session";
import {
  acceptInvitation,
  addMembers,
  createWorkspace,
  joinWithLink,
  removeMember,
  renameWorkspace,
  revokeInvitation,
  setJoinLink,
  setMemberRole,
  transferOwnership,
  updateWorkspaceSettings,
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

const ROLES: WorkspaceRole[] = ["owner", "member", "guest"];
const refresh = (workspaceId: string) => revalidatePath(`/w/${workspaceId}`, "layout");

export async function createWorkspaceAction(name: string) {
  const userId = await requireUserId();
  return run(async () => (await createWorkspace(userId, name)).id);
}

export async function updateWorkspaceSettingsAction(workspaceId: string, patch: Partial<WorkspaceSettings>) {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");
  const strongSession = isStrongSession(session);
  const result = await run(() => updateWorkspaceSettings(session.user.id, workspaceId, patch, { strongSession }));
  refresh(workspaceId);
  return result;
}

export async function renameWorkspaceAction(workspaceId: string, name: string) {
  const userId = await requireUserId();
  const result = await run(() => renameWorkspace(userId, workspaceId, name));
  refresh(workspaceId);
  return result;
}

export async function addMembersAction(workspaceId: string, emails: string[], role: WorkspaceRole) {
  const userId = await requireUserId();
  if (!ROLES.includes(role)) return fail("unknownRole");
  if (!Array.isArray(emails) || !emails.every((e) => typeof e === "string")) return fail("invalidEmail");
  const result = await run(() => addMembers(userId, workspaceId, emails, role));
  refresh(workspaceId);
  return result;
}

export async function transferOwnershipAction(workspaceId: string, targetId: string) {
  const userId = await requireUserId();
  const result = await run(() => transferOwnership(userId, workspaceId, targetId));
  refresh(workspaceId);
  return result;
}

const JOIN_LINK_MODES = ["enable", "disable", "regenerate"] as const;

/** Returns the join link, or null when it was turned off. */
export async function setJoinLinkAction(workspaceId: string, mode: (typeof JOIN_LINK_MODES)[number]) {
  const userId = await requireUserId();
  if (!JOIN_LINK_MODES.includes(mode)) throw new Error("Unknown mode");
  const result = await run(() => setJoinLink(userId, workspaceId, mode));
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

export async function revokeInvitationAction(workspaceId: string, invitationId: string) {
  const userId = await requireUserId();
  const result = await run(() => revokeInvitation(userId, workspaceId, invitationId));
  refresh(workspaceId);
  return result;
}

/** Takes a published page of the workspace offline. Owners only. */
export async function revokePublicationAction(workspaceId: string, pageId: string) {
  const userId = await requireUserId();
  const result = await run(() => revokePublication(userId, workspaceId, pageId));
  refresh(workspaceId);
  return result;
}

/** Turns off a form's public link. Owners only. */
export async function revokeFormPublicationAction(workspaceId: string, viewId: string) {
  const userId = await requireUserId();
  const result = await run(() => revokeFormPublication(userId, workspaceId, viewId));
  refresh(workspaceId);
  return result;
}

/** Joins the workspace of an invitation link as the signed-in account. Returns the workspace id. */
export async function acceptInvitationAction(token: string) {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");
  const result = await run(() => acceptInvitation(token, session.user.id, session.user.email));
  if (result.ok) refresh(result.data);
  return result;
}

/** Joins the workspace of a join link as the signed-in account. Returns the workspace id. */
export async function joinWithLinkAction(token: string) {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");
  const result = await run(() => joinWithLink(token, session.user.id, session.user.email));
  if (result.ok) refresh(result.data);
  return result;
}
