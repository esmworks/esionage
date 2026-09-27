import { getTranslations } from "next-intl/server";
import { toCsv } from "@/lib/csv";
import { isErrorValue } from "@/lib/derived";
import { env } from "@/lib/env";
import { asFiles } from "@/lib/files";
import { mapReferenceLines, markdownReferences } from "@/lib/embed-blocks";
import { pageLabel } from "@/lib/labels";
import { asChecklist, displayValue } from "@/lib/properties";
import { holdsPeople } from "@/lib/property-types";
import { AccessError } from "@/server/access";
import { getCollab } from "@/server/collab/bridge";
import { getDatabaseSnapshot, MAX_BULK_ROWS } from "@/server/databases";
import { resolveEmbeds } from "@/server/embeds";
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

/**
 * The rows a POST asks for (`{ "rows": [ids] }`, the table's selection), in that order; null for
 * a GET, which exports every row. Ids of rows the user can't see simply match nothing.
 */
async function requestedRows(request: Request): Promise<string[] | null> {
  if (request.method !== "POST") return null;
  const body: unknown = await request.json().catch(() => null);
  const rows = (body as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? rows.filter((id): id is string => typeof id === "string").slice(0, MAX_BULK_ROWS) : [];
}

/**
 * A page as Markdown, or a database's rows as CSV (all of them, or with POST the selected ones).
 * Pages the user can't see are 404.
 */
export async function GET(request: Request, { params }: { params: Promise<{ pageId: string }> }) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const { pageId } = await params;
  try {
    const target = await getPage(session.user.id, pageId);
    const only = await requestedRows(request);
    if (target.kind === "database") {
      const snapshot = await getDatabaseSnapshot(session.user.id, pageId);
      const byId = new Map(snapshot.rows.map((row) => [row.id, row]));
      const rows = only ? only.flatMap((id) => byId.get(id) ?? []) : snapshot.rows;
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
      // One line per checklist item, "[x] Done thing" / "[ ] Open thing".
      const checklist = (value: unknown) =>
        asChecklist(value)
          .map((item) => `[${item.checked ? "x" : " "}] ${item.text}`)
          .join("\n") || null;
      // One line per file, "photo.png (https://…/api/files/…)": the link opens for people who can see the row.
      const files = (value: unknown) =>
        asFiles(value)
          .map((f) => `${f.name} (${env.appUrl}${f.url})`)
          .join("\n") || null;
      const csv = toCsv([
        ["Name", ...snapshot.properties.map((p) => p.name)],
        ...rows.map((row) => [
          row.title,
          ...snapshot.properties.map((p) => {
            const value = row.properties[p.id];
            // A formula that fails on this row says why.
            if (isErrorValue(value)) return `#ERROR: ${value.error.message}`;
            if (p.type === "files") return files(value);
            return p.type === "checklist"
              ? checklist(value)
              : cell(displayValue(p, value), holdsPeople(p.type) ? nameOf : titleOf);
          }),
        ]),
      ]);
      return download(csv, "text/csv", fileName(target.title, "csv"));
    }
    const content = await getCollab().readPage(pageId);
    const title = content.title || target.title;
    const body = await linkEmbeds(session.user.id, content.markdown.trim());
    const markdown = `${title ? `# ${title}\n\n` : ""}${body}\n`;
    return download(markdown, "text/markdown", fileName(title, "md"));
  } catch (error) {
    if (error instanceof AccessError) return new Response("Not found", { status: 404 });
    throw error;
  }
}

/**
 * Database blocks as links to their database, for readers who can see it; a note otherwise, which
 * names nothing (see lib/embed-blocks).
 */
async function linkEmbeds(userId: string, markdown: string) {
  const embeds = await resolveEmbeds(userId, markdownReferences(markdown));
  if (!embeds.length) return markdown;
  const [t, tc] = await Promise.all([getTranslations("page.embed"), getTranslations("common")]);
  const byId = new Map(embeds.map((e) => [e.databaseId, e.database]));
  return mapReferenceLines(markdown, (ref) => {
    const database = byId.get(ref.databaseId);
    if (!database) return `*${t("unavailable")}*`;
    return `[${pageLabel(database.title, tc("untitled")).replace(/[[\]]/g, "\\$&")}](/w/${database.workspaceId}/p/${database.id})`;
  });
}

/** Exports the selected rows of a database: a POST, since a large selection would not fit in a URL. */
export const POST = GET;
