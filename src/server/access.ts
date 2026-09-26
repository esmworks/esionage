import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { page, workspaceMember, type WorkspaceRole } from "@/db/schema";

export class AccessError extends Error {
  constructor(message = "Not found or access denied") {
    super(message);
    this.name = "AccessError";
  }
}

export async function getMembership(userId: string, workspaceId: string) {
  const [row] = await db
    .select({ role: workspaceMember.role })
    .from(workspaceMember)
    .where(and(eq(workspaceMember.userId, userId), eq(workspaceMember.workspaceId, workspaceId)))
    .limit(1);
  return row ?? null;
}

export async function requireMembership(userId: string, workspaceId: string, role?: WorkspaceRole) {
  const membership = await getMembership(userId, workspaceId);
  if (!membership || (role && membership.role !== role)) throw new AccessError();
  return membership;
}

/** Loads a page the user may access. Throws AccessError otherwise (never leaks existence). */
export async function requirePageAccess(userId: string, pageId: string) {
  const [row] = await db
    .select({ page, role: workspaceMember.role })
    .from(page)
    .innerJoin(
      workspaceMember,
      and(eq(workspaceMember.workspaceId, page.workspaceId), eq(workspaceMember.userId, userId)),
    )
    .where(eq(page.id, pageId))
    .limit(1);
  if (!row) throw new AccessError();
  return row.page;
}
