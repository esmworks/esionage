import { and, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { page, workspaceMember, type WorkspaceRole } from "@/db/schema";

/**
 * The one place that decides who may see or change a page. Everything that reads or writes pages
 * goes through `requirePageAccess` (one page) or `pageVisibleTo` (lists, as a SQL condition), so
 * page-level sharing can be added here without touching the callers.
 *
 * Today access comes only from workspace membership, and every member has full access to every
 * page of the workspace.
 */

export class AccessError extends Error {
  constructor(message = "Not found or access denied") {
    super(message);
    this.name = "AccessError";
  }
}

/**
 * - `view`: read the page, its history and, for databases, its rows and schema.
 * - `edit`: change content, title, icon, properties, rows, views; move or trash it.
 * - `full`: also delete it for good (and, later, change who it is shared with).
 */
export type AccessLevel = "none" | "view" | "edit" | "full";
export type RequiredLevel = Exclude<AccessLevel, "none">;

const RANK: Record<AccessLevel, number> = { none: 0, view: 1, edit: 2, full: 3 };

export const hasLevel = (level: AccessLevel, needed: RequiredLevel) => RANK[level] >= RANK[needed];

/** What a page grants a user, from what is known about them. The access policy, in one function. */
export function pageAccessFor({ role }: { role: WorkspaceRole | null }): AccessLevel {
  return role ? "full" : "none";
}

export async function getMembership(userId: string, workspaceId: string) {
  const [row] = await db
    .select({ role: workspaceMember.role })
    .from(workspaceMember)
    .where(and(eq(workspaceMember.userId, userId), eq(workspaceMember.workspaceId, workspaceId)))
    .limit(1);
  return row ?? null;
}

/** For workspace-wide actions (creating top-level pages, managing members, workspace settings). */
export async function requireMembership(userId: string, workspaceId: string, role?: WorkspaceRole) {
  const membership = await getMembership(userId, workspaceId);
  if (!membership || (role && membership.role !== role)) throw new AccessError();
  return membership;
}

/** The page and the user's access to it; `none` when it doesn't exist or they may not see it. */
export async function resolvePageAccess(userId: string, pageId: string) {
  const [row] = await db
    .select({ page, role: workspaceMember.role })
    .from(page)
    .leftJoin(
      workspaceMember,
      and(eq(workspaceMember.workspaceId, page.workspaceId), eq(workspaceMember.userId, userId)),
    )
    .where(eq(page.id, pageId))
    .limit(1);
  if (!row) return { page: null, level: "none" as AccessLevel };
  return { page: row.page, level: pageAccessFor({ role: row.role }) };
}

/**
 * Loads a page the user may access at `needed` level. Throws AccessError otherwise, the same way
 * whether the page is missing or just not theirs, so its existence never leaks.
 */
export async function requirePageAccess(userId: string, pageId: string, needed: RequiredLevel) {
  const { page: found, level } = await resolvePageAccess(userId, pageId);
  if (!found || !hasLevel(level, needed)) throw new AccessError();
  return found;
}

/**
 * SQL condition: the page is visible to the user (at least `view`). Must match `pageAccessFor`.
 * Pass the alias when the page table is aliased in a raw query (`from page p` → "p").
 */
export function pageVisibleTo(userId: string, alias?: string): SQL {
  if (alias !== undefined && !/^[a-z_]+$/.test(alias)) throw new Error(`Bad table alias: ${alias}`);
  const workspaceId = alias ? sql.raw(`"${alias}"."workspace_id"`) : sql`${page.workspaceId}`;
  return sql`exists (select 1 from ${workspaceMember} where ${workspaceMember.workspaceId} = ${workspaceId} and ${workspaceMember.userId} = ${userId})`;
}
