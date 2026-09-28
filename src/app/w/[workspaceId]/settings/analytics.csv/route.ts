import { analyticsCsvRows, isAnalyticsTable, parseAnalyticsPeriod } from "@/lib/analytics";
import { toCsv } from "@/lib/csv";
import { AccessError } from "@/server/access";
import { workspaceAnalytics } from "@/server/analytics";
import { blockedByWorkspacePolicy, getSession, policyRefusal } from "@/server/session";

/**
 * One table of Settings > Analytics as CSV (`?table=members|pages&days=7|30|90`), for owners.
 * Anyone else gets 404 so the workspace's existence doesn't leak.
 */
export async function GET(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const { workspaceId } = await params;
  const hold = await blockedByWorkspacePolicy(session, workspaceId);
  if (hold) return new Response(policyRefusal(hold), { status: 403 });
  const url = new URL(request.url);
  const table = url.searchParams.get("table") ?? "members";
  if (!isAnalyticsTable(table)) return new Response("Unknown table", { status: 400 });
  try {
    const report = await workspaceAnalytics(session.user.id, workspaceId, parseAnalyticsPeriod(url.searchParams.get("days")));
    const date = new Date().toISOString().slice(0, 10);
    return new Response(toCsv(analyticsCsvRows(report, table)), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="analytics-${table}-${report.days}d-${date}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof AccessError) return new Response("Not found", { status: 404 });
    throw error;
  }
}
