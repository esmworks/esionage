import { and, asc, eq, sql } from "drizzle-orm";
import { getLocale, getTranslations } from "next-intl/server";
import { db } from "@/db";
import { user, workspace, workspaceMember, type WorkspaceRole } from "@/db/schema";
import { AccessError, requireMembership } from "@/server/access";
import { turkishGenitive } from "@/lib/turkish";
import { getCollab } from "@/server/collab/bridge";

/** "Erhan's workspace" / "Erhan'ın çalışma alanı", in the language of the sign-up request. */
async function personalWorkspaceName(userName: string) {
  const firstName = userName.trim().split(/\s+/)[0] || "My";
  try {
    const [locale, t] = await Promise.all([getLocale(), getTranslations("home")]);
    return t("personalWorkspace", { name: locale === "tr" ? turkishGenitive(firstName) : firstName });
  } catch {
    // Outside a request (scripts, tests) there is no locale to read.
    return `${firstName}'s workspace`;
  }
}

export async function createPersonalWorkspace(userId: string, userName: string) {
  const name = await personalWorkspaceName(userName);
  await db.transaction(async (tx) => {
    const [ws] = await tx
      .insert(workspace)
      .values({ name })
      .returning({ id: workspace.id });
    await tx.insert(workspaceMember).values({ workspaceId: ws.id, userId, role: "owner" });
  });
}

export type WorkspaceErrorCode =
  | "nameRequired"
  | "noAccount"
  | "alreadyMember"
  | "notMember"
  | "lastOwner"
  | "lastOwnerRemove";

/**
 * An expected failure the user can act on. `code` is stable and translated by the UI; the
 * English `message` is for logs.
 */
export class WorkspaceError extends Error {
  readonly code: WorkspaceErrorCode;

  constructor(code: WorkspaceErrorCode, message: string) {
    super(message);
    this.name = "WorkspaceError";
    this.code = code;
  }
}

export async function createWorkspace(userId: string, name: string) {
  const clean = name.trim().slice(0, 80);
  if (!clean) throw new WorkspaceError("nameRequired", "Give the workspace a name.");
  return db.transaction(async (tx) => {
    const [ws] = await tx.insert(workspace).values({ name: clean }).returning({ id: workspace.id });
    await tx.insert(workspaceMember).values({ workspaceId: ws.id, userId, role: "owner" });
    return ws;
  });
}

export async function getWorkspace(userId: string, workspaceId: string) {
  const { role } = await requireMembership(userId, workspaceId);
  const [ws] = await db
    .select({ id: workspace.id, name: workspace.name, icon: workspace.icon })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  return { ...ws, role };
}

export async function renameWorkspace(userId: string, workspaceId: string, name: string) {
  await requireMembership(userId, workspaceId, "owner");
  const clean = name.trim().slice(0, 80);
  if (!clean) throw new WorkspaceError("nameRequired", "Give the workspace a name.");
  await db.update(workspace).set({ name: clean }).where(eq(workspace.id, workspaceId));
}

export async function listMembers(userId: string, workspaceId: string) {
  await requireMembership(userId, workspaceId);
  return db
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      role: workspaceMember.role,
      joinedAt: workspaceMember.createdAt,
    })
    .from(workspaceMember)
    .innerJoin(user, eq(user.id, workspaceMember.userId))
    .where(eq(workspaceMember.workspaceId, workspaceId))
    .orderBy(asc(workspaceMember.createdAt));
}

/** Adds an existing account by email. There is no email delivery in v1, so no invitations. */
export async function addMember(actorId: string, workspaceId: string, email: string, role: WorkspaceRole) {
  await requireMembership(actorId, workspaceId, "owner");
  const [target] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(sql`lower(${user.email})`, email.trim().toLowerCase()))
    .limit(1);
  if (!target) throw new WorkspaceError("noAccount", "No account uses this email. Ask them to sign up first.");
  const inserted = await db
    .insert(workspaceMember)
    .values({ workspaceId, userId: target.id, role })
    .onConflictDoNothing()
    .returning({ userId: workspaceMember.userId });
  if (!inserted.length) throw new WorkspaceError("alreadyMember", "This person is already a member.");
}

/** Locks the owner rows so concurrent demotions/removals can't leave a workspace ownerless. */
async function countOwners(workspaceId: string, tx: Pick<typeof db, "select">) {
  const owners = await tx
    .select({ userId: workspaceMember.userId })
    .from(workspaceMember)
    .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.role, "owner")))
    .for("update");
  return owners.length;
}

export async function setMemberRole(actorId: string, workspaceId: string, targetId: string, role: WorkspaceRole) {
  await requireMembership(actorId, workspaceId, "owner");
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ role: workspaceMember.role })
      .from(workspaceMember)
      .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, targetId)))
      .for("update");
    if (!current) throw new WorkspaceError("notMember", "This person is not a member.");
    if (current.role === "owner" && role !== "owner" && (await countOwners(workspaceId, tx)) <= 1) {
      throw new WorkspaceError("lastOwner", "A workspace needs at least one owner.");
    }
    await tx
      .update(workspaceMember)
      .set({ role })
      .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, targetId)));
  });
}

/** Owners can remove anyone; members can only remove themselves (leave). */
export async function removeMember(actorId: string, workspaceId: string, targetId: string) {
  const actor = await requireMembership(actorId, workspaceId);
  if (actorId !== targetId && actor.role !== "owner") throw new AccessError();
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ role: workspaceMember.role })
      .from(workspaceMember)
      .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, targetId)))
      .for("update");
    if (!current) throw new WorkspaceError("notMember", "This person is not a member.");
    if (current.role === "owner" && (await countOwners(workspaceId, tx)) <= 1) {
      throw new WorkspaceError("lastOwnerRemove", "A workspace needs at least one owner. Make someone else an owner first.");
    }
    await tx
      .delete(workspaceMember)
      .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, targetId)));
  });
  await getCollab().disconnectUser(targetId, workspaceId);
}
