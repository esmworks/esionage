import { toCsv } from "@/lib/csv";
import { env } from "@/lib/env";
import { guestsCsvRows } from "@/lib/guests-csv";
import { pagePath } from "@/lib/mentions";
import { AccessError } from "@/server/access";
import { listGuests } from "@/server/guests";
import { blockedByWorkspacePolicy, getSession, policyRefusal } from "@/server/session";

/**
 * Settings > Guests as CSV, for whoever sees the tab, with what it shows them. Anyone else gets
 * 404 so the workspace's existence doesn't leak.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const { workspaceId } = await params;
  const hold = await blockedByWorkspacePolicy(session, workspaceId);
  if (hold) return new Response(policyRefusal(hold), { status: 403 });
  try {
    const guests = await listGuests(session.user.id, workspaceId);
    const csv = toCsv(guestsCsvRows(guests, (pageId) => `${env.appUrl}${pagePath(workspaceId, pageId)}`));
    const date = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="guests-${date}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof AccessError) return new Response("Not found", { status: 404 });
    throw error;
  }
}
