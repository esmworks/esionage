import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/lib/auth";

export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

/** For pages and layouts: redirects to sign-in when there is no session. */
export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return session.user;
}

/** For server actions: throws instead of redirecting. */
export async function requireUserId() {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");
  return session.user.id;
}
