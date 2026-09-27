import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/lib/auth";
import { isStrongSession } from "@/lib/auth-security";
import { twoFactorPolicyApplies } from "@/server/access";

export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

/** Set by src/proxy.ts on app routes: the path being requested, to come back to after signing in. */
const PATH_HEADER = "x-esionage-path";

/** For pages and layouts: redirects to sign-in when there is no session. */
export async function requireSession() {
  const session = await getSession();
  if (!session) {
    const path = (await headers()).get(PATH_HEADER);
    // The sign-in page only follows same-origin paths (safeNext), so this can't point elsewhere.
    redirect(path ? `/sign-in?next=${encodeURIComponent(path)}` : "/sign-in");
  }
  return session;
}

/** For pages and layouts: the signed-in user, or a redirect to sign-in. */
export async function requireUser() {
  return (await requireSession()).user;
}

type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;

/**
 * Whether the workspace requires two-step verification and this member's session doesn't pass it
 * (see isStrongSession). Non-members get false: their own access checks turn them away, without
 * learning the workspace's policy.
 */
export async function blockedByTwoFactorPolicy(session: Session, workspaceId: string) {
  return !isStrongSession(session) && (await twoFactorPolicyApplies(session.user.id, workspaceId));
}

/**
 * For the pages under /w/[workspaceId] (the layout and each page, as Next renders them in
 * parallel): a session the workspace's two-step policy turns away goes to the page where they set
 * it up. Server actions and API routes get TwoFactorRequiredError from the access checks instead
 * (see access.ts). Connected apps (MCP) reach data with OAuth tokens and aren't affected.
 */
export async function requireWorkspaceSession(workspaceId: string) {
  const session = await requireSession();
  if (await blockedByTwoFactorPolicy(session, workspaceId)) redirect(twoStepPath(workspaceId));
  return session;
}

export const twoStepPath = (workspaceId: string) => `/two-step/${encodeURIComponent(workspaceId)}`;

/** For server actions: throws instead of redirecting. */
export async function requireUserId() {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");
  return session.user.id;
}
