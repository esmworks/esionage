import { and, eq, getTableColumns, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { page, PAGE_LEVELS, workspaceMember, type PageLevel, type WorkspaceRole } from "@/db/schema";

/**
 * The one place that decides who may see or change a page. Everything that reads or writes pages
 * goes through `requirePageAccess` (one page) or `pageVisibleTo` (lists, as a SQL condition).
 *
 * The rule itself is the SQL function `page_access_level` (drizzle/0003_page_permission.sql):
 * workspace members get full access unless a page permission on the page or its nearest ancestor
 * says otherwise, and anyone in the workspace can be given access to a page and its subpages.
 */

export class AccessError extends Error {
  constructor(message = "Not found or access denied") {
    super(message);
    this.name = "AccessError";
  }
}

/**
 * - `view`: read the page, its history and, for databases, its rows and schema.
 * - `comment`: also comment on it (see server/comments.ts).
 * - `edit`: change content, title, icon, properties, rows, views; move or trash it.
 * - `full`: also delete it for good (and, later, change who it is shared with).
 */
export type AccessLevel = PageLevel;
export type RequiredLevel = Exclude<AccessLevel, "none">;

const rank = (level: AccessLevel) => PAGE_LEVELS.indexOf(level);

export const hasLevel = (level: AccessLevel, needed: RequiredLevel) => rank(level) >= rank(needed);

/** The rank `page_access_level` returns for full access, for SQL that looks for it. */
export const FULL_RANK = rank("full");

/** The level `page_access_level` returns (0–4) as a name; anything unexpected is `none`. */
export const levelFromRank = (value: unknown): AccessLevel => PAGE_LEVELS[Number(value)] ?? "none";

/** SQL: the user's access rank (0–4) on a page id expression. */
export const accessRank = (userId: string, pageId: SQL) => sql<number>`page_access_level(${userId}, ${pageId})`;

export async function getMembership(userId: string, workspaceId: string) {
  const [row] = await db
    .select({ role: workspaceMember.role })
    .from(workspaceMember)
    .where(and(eq(workspaceMember.userId, userId), eq(workspaceMember.workspaceId, workspaceId)))
    .limit(1);
  return row ?? null;
}

/** Anyone in the workspace, guests included: for reads that filter pages by `pageVisibleTo`. */
export async function requireMembership(userId: string, workspaceId: string, role?: WorkspaceRole) {
  const membership = await getMembership(userId, workspaceId);
  if (!membership || (role && membership.role !== role)) throw new AccessError();
  return membership;
}

export const isGuest = (role: WorkspaceRole) => role === "guest";

/**
 * An owner or member, not a guest: for creating top-level pages and for seeing who is in the
 * workspace. Must match the roles `page_access_level` gives workspace-wide access to.
 */
export async function requireMember(userId: string, workspaceId: string) {
  const membership = await requireMembership(userId, workspaceId);
  if (isGuest(membership.role)) throw new AccessError();
  return membership;
}

/** The page and the user's access to it; `none` when it doesn't exist or they may not see it. */
export async function resolvePageAccess(userId: string, pageId: string) {
  const [row] = await db
    .select({ ...getTableColumns(page), level: accessRank(userId, sql`${page.id}`) })
    .from(page)
    .where(eq(page.id, pageId))
    .limit(1);
  if (!row) return { page: null, level: "none" as AccessLevel };
  const { level, ...found } = row;
  return { page: found, level: levelFromRank(level) };
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
 * SQL condition: the user can at least view the page. Pass the alias when the page table is
 * aliased in a raw query (`from page p` → "p").
 */
export function pageVisibleTo(userId: string, alias?: string): SQL {
  return sql`${accessRank(userId, pageIdColumn(alias))} > 0`;
}

/** The page id column, or `alias.id` in raw queries. */
export function pageIdColumn(alias?: string): SQL {
  if (alias !== undefined && !/^[a-z_]+$/.test(alias)) throw new Error(`Bad table alias: ${alias}`);
  return alias ? sql.raw(`"${alias}"."id"`) : sql`${page.id}`;
}
