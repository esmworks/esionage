import { toCsv } from "@/lib/csv";
import { displayValue } from "@/lib/properties";
import { AccessError } from "@/server/access";
import { getCollab } from "@/server/collab/bridge";
import { getDatabaseSnapshot } from "@/server/databases";
import { getPage } from "@/server/pages";
import { getSession } from "@/server/session";

/** A file name without characters that trip up file systems or the Content-Disposition header. */
function fileName(title: string, extension: string) {
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Untitled";
  return `filename="${base.replace(/[^\x20-\x7e]/g, "_")}.${extension}"; filename*=UTF-8''${encodeURIComponent(base)}.${extension}`;
}

function download(body: string, type: string, disposition: string) {
  return new Response(body, {
    headers: {
      "Content-Type": `${type}; charset=utf-8`,
      "Content-Disposition": `attachment; ${disposition}`,
      "Cache-Control": "no-store",
    },
  });
}

/** A page as Markdown, or a database's rows as CSV. Pages the user can't see are 404. */
export async function GET(_request: Request, { params }: { params: Promise<{ pageId: string }> }) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const { pageId } = await params;
  try {
    const target = await getPage(session.user.id, pageId);
    if (target.kind === "database") {
      const snapshot = await getDatabaseSnapshot(session.user.id, pageId);
      const rows = snapshot.rows;
      const titleOf = new Map(
        Object.values(snapshot.relations).flatMap((r) => r.rows.map((row) => [row.id, row.title] as const)),
      );
      // A relation to the same database would otherwise print ids for its trashed rows.
      if (target.archivedAt) for (const row of rows) if (!titleOf.has(row.id)) titleOf.set(row.id, row.title);
      const nameOf = new Map(snapshot.people.map((p) => [p.id, p.name] as const));
      const cell = (value: unknown, names: Map<string, string>): string | number | null => {
        if (value === null || value === undefined || value === "") return null;
        if (Array.isArray(value)) return value.map((v) => names.get(String(v)) ?? String(v)).join(", ");
        if (typeof value === "boolean") return value ? "true" : "false";
        return typeof value === "number" ? value : String(value);
      };
      const csv = toCsv([
        ["Name", ...snapshot.properties.map((p) => p.name)],
        ...rows.map((row) => [
          row.title,
          ...snapshot.properties.map((p) => cell(displayValue(p, row.properties[p.id]), p.type === "person" ? nameOf : titleOf)),
        ]),
      ]);
      return download(csv, "text/csv", fileName(target.title, "csv"));
    }
    const content = await getCollab().readPage(pageId);
    const title = content.title || target.title;
    const markdown = `${title ? `# ${title}\n\n` : ""}${content.markdown.trim()}\n`;
    return download(markdown, "text/markdown", fileName(title, "md"));
  } catch (error) {
    if (error instanceof AccessError) return new Response("Not found", { status: 404 });
    throw error;
  }
}
