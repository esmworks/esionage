import { and, eq, getTableColumns, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  page,
  PAGE_LEVELS,
  ssoProvider,
  workspace,
  workspaceMember,
  workspaceSso,
  type PageLevel,
  type WorkspaceRole,
} from "@/db/schema";
import { env } from "@/lib/env";
import { INSTANCE_SSO_PROVIDER_ID, workspaceProviderId } from "@/lib/sso-config";
import { requestSession } from "@/server/request-session";

/**
 * The one place that decides who may see or change a page. Everything that reads or writes pages
 * goes through `requirePageAccess` (one page) or `pageVisibleTo` (lists, as a SQL condition).
 *
 * The rule itself is the SQL function `page_access_level` (drizzle/0003_page_permission.sql):
 * workspace members get full access unless a page permission on the page or its nearest ancestor
 * says otherwise, and anyone in the workspace can be given access to a page and its subpages.
 *
 * A workspace's sign-in policies (require two-step verification, "SSO only") also hold back the
 * browser sessions that don't meet them: `getMembership` and `resolvePageAccess` (and everything
 * built on them, so server actions and API routes alike) throw a WorkspacePolicyError
 * (TwoFactorRequiredError, SsoRequiredError) for the signed-in user of such a request. The collab
 * server checks its connections itself (collab/authorize.ts); MCP's OAuth tokens, the REST API's
 * personal access tokens (/api/v1) and SCIM tokens are outside the policies: they are credentials
 * handed to a program, revoked in Settings, not sign-ins. Lists filtered only in SQL
 * (`pageVisibleTo`) run after one of those checks, or ask `sessionHeldBack` themselves.
 */

export class AccessError extends Error {
  constructor(message = "Not found or access denied") {
    super(message);
    this.name = "AccessError";
  }
}

/**
 * Which of a workspace's sign-in policies holds a session back: "require two-step verification"
 * (`two-factor`) or the "SSO only" login method (`sso`).
 */
export type PolicyHold = "two-factor" | "sso";

/**
 * The workspace's sign-in policy holds back the session serving this request. Pages send it to the
 * page where it can meet the policy (`/two-step/<id>`, `/sso-required/<id>`, see policyGatePath).
 */
export class WorkspacePolicyError extends AccessError {
  constructor(
    readonly workspaceId: string,
    readonly hold: PolicyHold,
    message: string,
  ) {
    super(message);
    this.name = "WorkspacePolicyError";
  }
}

/** The workspace requires two-step verification and the session doesn't pass it (isStrongSession). */
export class TwoFactorRequiredError extends WorkspacePolicyError {
  constructor(workspaceId: string) {
    super(workspaceId, "two-factor", "This workspace requires two-step verification");
    this.name = "TwoFactorRequiredError";
  }
}

/** Members of the workspace must sign in through its single sign-on, and this session didn't. */
export class SsoRequiredError extends WorkspacePolicyError {
  constructor(workspaceId: string) {
    super(workspaceId, "sso", "This workspace requires signing in with single sign-on");
    this.name = "SsoRequiredError";
  }
}

export function policyError(workspaceId: string, hold: PolicyHold): WorkspacePolicyError {
  return hold === "sso" ? new SsoRequiredError(workspaceId) : new TwoFactorRequiredError(workspaceId);
}

/** What the policies look at in a browser session. */
export type SessionFacts = {
  /** Passes "require two-step verification" (see isStrongSession). */
  strong: boolean;
  /** The SSO provider the session was signed in through, if any (`session.sso_provider_id`). */
  ssoProviderId: string | null;
};

/** A workspace's policy settings and whether its SSO is usable: what `policyHold` decides on. */
export type PolicyState = {
  role: WorkspaceRole;
  requireTwoFactor: boolean;
  loginMethod: "any" | "sso";
  /** The workspace has an SSO connection with verified domains. */
  hasConnection: boolean;
  /** The instance-wide provider is configured (OIDC_ISSUER…). */
  instanceSso: boolean;
};

/**
 * Pure: whether the policies hold back a session. Two-step applies to everyone in the workspace,
 * guests too. "SSO only" applies to members: owners keep their other ways in (a broken identity
 * provider must not lock the workspace), and guests come from outside the organization. A session
 * counts when it came through the workspace's own connection or the instance provider. While
 * neither exists the policy has nothing to send people to, so it holds nobody back.
 */
export function policyHold(state: PolicyState, facts: SessionFacts, workspaceId: string): PolicyHold | null {
  if (state.requireTwoFactor && !facts.strong) return "two-factor";
  if (state.loginMethod !== "sso" || state.role !== "member") return null;
  if (!state.hasConnection && !state.instanceSso) return null;
  const provider = facts.ssoProviderId;
  if (provider && state.hasConnection && provider === workspaceProviderId(workspaceId)) return null;
  if (provider === INSTANCE_SSO_PROVIDER_ID && state.instanceSso) return null;
  return "sso";
}

/** The workspace's policy state for `userId`, or null when they don't belong to it. */
export async function policyStateOf(userId: string, workspaceId: string): Promise<PolicyState | null> {
  const [row] = await db
    .select({
      role: workspaceMember.role,
      requireTwoFactor: sql<boolean>`coalesce((${workspace.settings}->>'requireTwoFactor')::boolean, false)`,
      loginMethod: sql<string | null>`${workspace.settings}->>'loginMethod'`,
      hasConnection: sql<boolean>`exists (
        select 1 from ${workspaceSso} c join ${ssoProvider} p on p.provider_id = c.provider_id
        where c.workspace_id = ${workspace.id} and coalesce(p.domain_verified, false))`,
    })
    .from(workspaceMember)
    .innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
    .where(and(eq(workspaceMember.userId, userId), eq(workspaceMember.workspaceId, workspaceId)))
    .limit(1);
  if (!row) return null;
  return {
    role: row.role,
    requireTwoFactor: row.requireTwoFactor === true,
    loginMethod: row.loginMethod === "sso" ? "sso" : "any",
    hasConnection: row.hasConnection === true,
    instanceSso: env.instanceOidc !== null,
  };
}

/**
 * The policy holding back `userId`'s session with these facts in the workspace, or null (also when
 * they don't belong to it: their own access checks turn them away without learning its policy).
 */
export async function policyHoldFor(userId: string, workspaceId: string, facts: SessionFacts): Promise<PolicyHold | null> {
  const state = await policyStateOf(userId, workspaceId);
  return state ? policyHold(state, facts, workspaceId) : null;
}

/**
 * Which policy holds back the browser session serving this request, when it belongs to `userId`.
 * Null outside requests, for bearer tokens, for other users (checks on someone else's behalf, like
 * who a page is shared with) and for sessions that pass. Asked once per request and workspace.
 */
export async function sessionHold(userId: string, workspaceId: string): Promise<PolicyHold | null> {
  const current = await requestSession();
  if (!current || current.userId !== userId) return null;
  let held = current.heldBack.get(workspaceId);
  if (!held) {
    held = policyHoldFor(userId, workspaceId, current);
    current.heldBack.set(workspaceId, held);
  }
  return held;
}

/** Whether a workspace policy holds back this request's session (see sessionHold). */
export async function sessionHeldBack(userId: string, workspaceId: string): Promise<boolean> {
  return (await sessionHold(userId, workspaceId)) !== null;
}

export async function enforceWorkspacePolicy(userId: string, workspaceId: string) {
  const hold = await sessionHold(userId, workspaceId);
  if (hold) throw policyError(workspaceId, hold);
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
 * The user's role in the workspace, or null. Throws a WorkspacePolicyError when one of the
 * workspace's sign-in policies holds back the session of this request (see `findMembership`).
 */
export async function getMembership(userId: string, workspaceId: string) {
  const membership = await findMembership(userId, workspaceId);
  if (membership) await enforceWorkspacePolicy(userId, workspaceId);
  return membership;
}

/**
 * The role, without the sign-in policies: for the policies themselves and the pages that send people
 * to meet them, and for questions about someone's standing rather than the request's session.
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
 * a WorkspacePolicyError when they may, but a sign-in policy of the workspace holds back the session
 * of this request (see `pageAccessOf`).
 */
export async function resolvePageAccess(userId: string, pageId: string) {
  const resolved = await pageAccessOf(userId, pageId);
  if (resolved.page && resolved.level !== "none") await enforceWorkspacePolicy(userId, resolved.page.workspaceId);
  return resolved;
}

/**
 * The page and someone's access to it, without the sign-in policies: what a user's standing allows
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
