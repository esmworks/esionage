import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { issueCollabToken } from "@/server/collab/token";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(
    { token: issueCollabToken(session.user.id, session.user.name, session.session.id) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
