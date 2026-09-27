/**
 * The browser session behind the request being served, for the checks deep in the data layer that
 * only get a user id (see access.ts, which holds sessions to the workspace's two-step policy).
 *
 * Null outside a Next request (the collab server, scripts, tests), for requests that authenticate
 * with a bearer token (MCP's OAuth tokens and the REST API's personal access tokens are outside the
 * policy) and without a sign-in. Looked up
 * once per request.
 */
export type RequestSession = {
  userId: string;
  /** Passes a "require two-step verification" policy (see isStrongSession). */
  strong: boolean;
  /** Per workspace id: whether its policy holds this session back. Filled by access.ts. */
  heldBack: Map<string, Promise<boolean>>;
};

const byRequest = new WeakMap<object, Promise<RequestSession | null>>();

export async function requestSession(): Promise<RequestSession | null> {
  let requestHeaders: Headers;
  try {
    // Loaded on demand: this module is imported by code that also runs outside Next.
    const { headers } = await import("next/headers");
    requestHeaders = await headers();
  } catch (error) {
    // Next's own control flow (dynamic rendering bailouts and the like) must go through.
    const { unstable_rethrow } = await import("next/navigation");
    unstable_rethrow(error);
    return null; // "called outside a request scope"
  }
  let found = byRequest.get(requestHeaders);
  if (!found) {
    found = lookUp(requestHeaders);
    byRequest.set(requestHeaders, found);
  }
  return found;
}

async function lookUp(requestHeaders: Headers): Promise<RequestSession | null> {
  if (/^bearer\s/i.test(requestHeaders.get("authorization") ?? "")) return null;
  const [{ auth }, { isStrongSession }] = await Promise.all([import("@/lib/auth"), import("@/lib/auth-security")]);
  const session = await auth.api.getSession({ headers: requestHeaders }).catch(() => null);
  if (!session) return null;
  return { userId: session.user.id, strong: isStrongSession(session), heldBack: new Map() };
}
