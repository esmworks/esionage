import { getTimeZone, getTranslations } from "next-intl/server";
import { auditCsvRows, parseAuditFilters, type AuditTranslator } from "@/lib/audit";
import { toCsv } from "@/lib/csv";
import { AccessError } from "@/server/access";
import { auditEventsForExport } from "@/server/audit";
import { blockedByWorkspacePolicy, getSession, policyRefusal } from "@/server/session";

/**
 * Settings > Audit log as CSV, with the filters of the list (`actor`, `category`, `from`, `to`), all
 * pages of it, for owners. Anyone else gets 404 so the workspace's existence doesn't leak.
 */
export async function GET(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const { workspaceId } = await params;
  const hold = await blockedByWorkspacePolicy(session, workspaceId);
  if (hold) return new Response(policyRefusal(hold), { status: 403 });
  const filters = parseAuditFilters(new URL(request.url).searchParams);
  try {
    // Days of the range in the viewer's time zone, as in the list; descriptions in their language.
    const [events, t] = await Promise.all([
      auditEventsForExport(session.user.id, workspaceId, filters, { timeZone: await getTimeZone() }),
      getTranslations("settings"),
    ]);
    const date = new Date().toISOString().slice(0, 10);
    return new Response(toCsv(auditCsvRows(events, t as unknown as AuditTranslator)), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="audit-log-${date}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof AccessError) return new Response("Not found", { status: 404 });
    throw error;
  }
}
