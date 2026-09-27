import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/lib/auth";

export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

/** Set by src/proxy.ts on app routes: the path being requested, to come back to after signing in. */
const PATH_HEADER = "x-esionage-path";

/** For pages and layouts: redirects to sign-in when there is no session. */
export async function requireUser() {
  const session = await getSession();
  if (!session) {
    const path = (await headers()).get(PATH_HEADER);
    // The sign-in page only follows same-origin paths (safeNext), so this can't point elsewhere.
    redirect(path ? `/sign-in?next=${encodeURIComponent(path)}` : "/sign-in");
  }
  return session.user;
}

/** For server actions: throws instead of redirecting. */
export async function requireUserId() {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");
  return session.user.id;
}
