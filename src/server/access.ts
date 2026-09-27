import { and, eq, getTableColumns, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { page, PAGE_LEVELS, workspace, workspaceMember, type PageLevel, type WorkspaceRole } from "@/db/schema";
import { requestSession } from "@/server/request-session";

/**
 * The one place that decides who may see or change a page. Everything that reads or writes pages
 * goes through `requirePageAccess` (one page) or `pageVisibleTo` (lists, as a SQL condition).
 *
 * The rule itself is the SQL function `page_access_level` (drizzle/0003_page_permission.sql):
 * workspace members get full access unless a page permission on the page or its nearest ancestor
 * says otherwise, and anyone in the workspace can be given access to a page and its subpages.
 *
 * A workspace that requires two-step verification also holds back the browser sessions that don't
 * pass it: `getMembership` and `resolvePageAccess` (and everything built on them, so server actions
 * and API routes alike) throw TwoFactorRequiredError for the signed-in user of such a request. The
 * collab server checks its connections itself (collab/authorize.ts); MCP's OAuth tokens are outside
 * the policy. Lists filtered only in SQL (`pageVisibleTo`) run after one of those checks, or ask
 * `sessionHeldBack` themselves.
 */

export class AccessError extends Error {
  constructor(message = "Not found or access denied") {
    super(message);
    this.name = "AccessError";
  }
}

/**
 * The workspace requires two-step verification and the session serving this request doesn't pass
 * it (see isStrongSession). Pages send it to the page where it sets one up (`/two-step/<id>`).
 */
export class TwoFactorRequiredError extends AccessError {
  constructor(readonly workspaceId: string) {
    super("This workspace requires two-step verification");
    this.name = "TwoFactorRequiredError";
  }
}

/** Whether `workspaceId` requires two-step verification and `userId` belongs to it (guests too). */
export async function twoFactorPolicyApplies(userId: string, workspaceId: string) {
  const [row] = await db
    .select({ one: sql<number>`1` })
    .from(workspaceMember)
    .innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
    .where(
      and(
        eq(workspaceMember.userId, userId),
        eq(workspaceMember.workspaceId, workspaceId),
        sql`coalesce((${workspace.settings}->>'requireTwoFactor')::boolean, false)`,
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * Whether the browser session serving this request belongs to `userId` and the workspace's two-step
 * policy holds it back. False outside requests, for bearer tokens, for other users (checks on
 * someone else's behalf, like who a page is shared with) and for sessions that pass.
 */
export async function sessionHeldBack(userId: string, workspaceId: string): Promise<boolean> {
  const current = await requestSession();
  if (!current || current.userId !== userId || current.strong) return false;
  let held = current.heldBack.get(workspaceId);
  if (!held) {
    held = twoFactorPolicyApplies(userId, workspaceId);
    current.heldBack.set(workspaceId, held);
  }
  return held;
}

export async function enforceTwoFactorPolicy(userId: string, workspaceId: string) {
  if (await sessionHeldBack(userId, workspaceId)) throw new TwoFactorRequiredError(workspaceId);
}

/** Of these workspace ids, the ones whose two-step policy holds back this request's session. */
export async function workspacesHeldBack(userId: string, workspaceIds: Iterable<string>): Promise<Set<string>> {
  const ids = [...new Set(workspaceIds)];
  const held = await Promise.all(ids.map((id) => sessionHeldBack(userId, id)));
  return new Set(ids.filter((_, i) => held[i]));
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

/**
 * The user's role in the workspace, or null. Throws TwoFactorRequiredError when the workspace's
 * two-step policy holds back the session of this request (see `findMembership`).
 */
export async function getMembership(userId: string, workspaceId: string) {
  const membership = await findMembership(userId, workspaceId);
  if (membership) await enforceTwoFactorPolicy(userId, workspaceId);
  return membership;
}

/**
 * The role, without the two-step policy: for the policy itself and the page that sends people to
 * set it up, and for questions about someone's standing rather than the request's session.
 */
export async function findMembership(userId: string, workspaceId: string) {
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

/**
 * The page and the user's access to it; `none` when it doesn't exist or they may not see it. Throws
 * TwoFactorRequiredError when they may, but the workspace's two-step policy holds back the session
 * of this request (see `pageAccessOf`).
 */
export async function resolvePageAccess(userId: string, pageId: string) {
  const resolved = await pageAccessOf(userId, pageId);
  if (resolved.page && resolved.level !== "none") await enforceTwoFactorPolicy(userId, resolved.page.workspaceId);
  return resolved;
}

/**
 * The page and someone's access to it, without the two-step policy: what a user's standing allows
 * (a form publisher's, say), not what the request's session may do.
 */
export async function pageAccessOf(userId: string, pageId: string) {
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
