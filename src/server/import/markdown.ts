import { Readable } from "node:stream";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { page } from "@/db/schema";
import { csvTable, decodeText, guessTitleColumn } from "@/lib/import/csv";
import { LOCALES } from "@/i18n/config";
import { loadMessages } from "@/i18n/messages";
import {
  IMPORT_LIMITS,
  importFileKind,
  liftImages,
  planImport,
  rewriteLinks,
  splitTitle,
  stripRowProperties,
  withoutFrontMatter,
} from "@/lib/import/markdown";
import { ImportError, WarningList, type ImportResult } from "@/lib/import/result";
import { pagePath } from "@/lib/mentions";
import { AccessError, requirePageAccess } from "@/server/access";
import { getCollab, type WriteActor } from "@/server/collab/bridge";
import { FileError, uploadFile } from "@/server/files";
import { createPage, removeOrphanFiles, type DatabaseSeedNames } from "@/server/pages";
import { collectFiles, type UploadedFile } from "./archive";
import { importCsvAsDatabase } from "./csv";

/**
 * Imports Markdown files, CSV files and ZIPs of them as pages under a page (or at the top level of
 * a workspace), keeping their folders as the page tree (see lib/import/markdown for the layout).
 *
 * In two passes: first every page and database is created, so that then each page's Markdown can
 * be written with its links rewritten: links to other imported files become links to their pages
 * (which the editor shows as page mentions), and images and files it shows by relative path are
 * uploaded to the page and the links pointed at the uploads.
 *
 * Esionage's own export comes back as it went: `Templates/` folders become row templates of their
 * database and, when importing at the workspace's top level, workspace templates (elsewhere they're
 * a page of that name: templates only live at the top), and the property list the export writes at
 * the top of a row's page is left out of the body when the row's CSV values say the same.
 *
 * All or nothing: limits are checked before anything is created, and if creating or writing fails
 * midway, what the import created so far is deleted again (uploads with it). What an import that
 * went through left out (a missing image, a file over the upload limit) comes back as warnings.
 */

const text = decodeText;

/** Titles the export gives untitled pages (in each language), for matching a row with no title. */
const UNTITLED = new Set(
  (await Promise.all(LOCALES.map(loadMessages))).map((messages) => messages.common.untitled.toLowerCase()),
);

export type MarkdownImportInput = {
  workspaceId: string;
  /** The page the import goes under; null for the workspace's top level. */
  parentId: string | null;
  /** At the top level: the teamspace, null for private pages, undefined for the default teamspace (see createPage). */
  teamspaceId?: string | null;
  files: UploadedFile[];
  seedNames?: DatabaseSeedNames;
};

type Created = { id: string; kind: "page" | "database" | "row"; title: string; template: boolean };

export async function importPages(actor: WriteActor, input: MarkdownImportInput): Promise<ImportResult> {
  const { userId } = actor;
  let workspaceId = input.workspaceId;
  if (input.parentId) {
    const parent = await requirePageAccess(userId, input.parentId, "edit");
    if (parent.archivedAt) throw new ImportError("The page is in the trash", "noAccess");
    if (parent.kind !== "page") throw new ImportError("Pages can only be imported into a page", "badRequest");
    workspaceId = parent.workspaceId;
  }

  const warnings = new WarningList();
  const collected = collectFiles(input.files);
  const files = collected.files;
  for (const path of collected.skipped) warnings.add({ code: "skipped", path, reason: "nestedZip" });
  // Markdown files over the limit are left out rather than read.
  for (const [path, bytes] of files) {
    if (importFileKind(path) === "markdown" && bytes.byteLength > IMPORT_LIMITS.markdownBytes) {
      files.delete(path);
      warnings.add({ code: "skipped", path, reason: "tooLarge" });
    }
  }
  const plan = planImport([...files.keys()], { topLevel: input.parentId === null });
  for (const s of plan.skipped) warnings.add({ code: "skipped", path: s.path, reason: s.reason });
  if (!plan.nodes.length) throw new ImportError("There is no Markdown or CSV file to import", "nothingToImport");
  if (plan.nodes.length > IMPORT_LIMITS.pages) {
    throw new ImportError(`An import can create at most ${IMPORT_LIMITS.pages} pages`, "tooManyPages", { limit: IMPORT_LIMITS.pages });
  }

  // Titles and bodies from the files. A folder keeps its name; its index file's heading only goes
  // (as the title) when it names the folder the same.
  const bodies = new Map<string, string>();
  const titles = new Map<string, string>();
  for (const node of plan.nodes) {
    if (!node.source || node.kind === "database") {
      titles.set(node.key, node.title);
      continue;
    }
    const markdown = text(files.get(node.source)!);
    const split = splitTitle(markdown, node.title);
    if (node.key.endsWith("/") && split.title.toLowerCase() !== node.title.toLowerCase()) {
      titles.set(node.key, node.title);
      bodies.set(node.key, withoutFrontMatter(markdown));
    } else {
      titles.set(node.key, split.title);
      bodies.set(node.key, split.body);
    }
  }

  const created = new Map<string, Created>();
  const roots: Created[] = [];
  const counts = { pages: 0, databases: 0, rows: 0, templates: 0, files: 0 };
  // Rows of imported databases that no page of the database's folder has claimed yet, with their
  // cells (to recognise the property list an exported row page starts with).
  type Unclaimed = { id: string; title: string; cells: string[] };
  const unclaimed = new Map<string, Unclaimed[]>();
  const tables = new Map<string, { headers: string[]; titleColumn: number | null }>();
  try {
    for (const node of plan.nodes) {
      const parentId = node.parent ? created.get(node.parent)!.id : input.parentId;
      const title = titles.get(node.key)!;
      let id: string;
      if (node.kind === "database") {
        const table = csvTable(text(files.get(node.source!)!));
        const titleColumn = guessTitleColumn(table.headers);
        const result = await importCsvAsDatabase(
          actor,
          {
            workspaceId,
            parentId,
            teamspaceId: input.teamspaceId,
            title,
            table,
            titleColumn,
            seedNames: input.seedNames,
            template: node.template,
          },
          warnings,
        );
        id = result.database.id;
        // Rows come back in the CSV's order.
        unclaimed.set(node.key, result.rows.map((r, i) => ({ ...r, cells: table.rows[i] })));
        tables.set(node.key, { headers: table.headers, titleColumn });
        if (node.template) counts.templates++;
        else counts.databases++;
        counts.rows += result.rows.length;
      } else {
        const rows = node.kind === "row" && !node.template ? unclaimed.get(node.parent!) : undefined;
        const match = rows ? matchRow(rows, title) : -1;
        if (rows && match !== -1) {
          const row = rows.splice(match, 1)[0];
          id = row.id;
          const body = bodies.get(node.key);
          const table = tables.get(node.parent!)!;
          if (body !== undefined) bodies.set(node.key, stripRowProperties(body, table.headers, row.cells, table.titleColumn));
        } else {
          id = (await createPage(actor, { workspaceId, parentId, teamspaceId: input.teamspaceId, title, template: node.template })).id;
          if (node.template) counts.templates++;
          else if (node.kind === "row") counts.rows++;
          else counts.pages++;
        }
      }
      const entry: Created = { id, kind: node.kind, title, template: Boolean(node.template) };
      created.set(node.key, entry);
      if (!node.parent) roots.push(entry);
    }

    // Uploads by path: one stored file however many pages show it (null: it couldn't be stored).
    const uploads = new Map<string, string | null>();
    const target = (path: string): string | null => {
      const key = plan.nodeOf.get(path) ?? plan.nodeOf.get(path.replace(/\/$/, ""));
      const linked = key ? created.get(key) : undefined;
      return linked ? pagePath(workspaceId, linked.id) : null;
    };
    for (const node of plan.nodes) {
      const body = bodies.get(node.key);
      if (body === undefined) continue;
      const pageId = created.get(node.key)!.id;
      const pending: { path: string; token: string }[] = [];
      let rewritten = rewriteLinks(body, node.source!, ({ path }) => {
        const linked = target(path);
        if (linked) return linked;
        if (!files.has(path) || importFileKind(path) !== "asset") {
          warnings.add({ code: "missingFile", path, page: titles.get(node.key)! });
          return null;
        }
        // Uploads are async and this callback isn't: a placeholder now, the file's URL below.
        const token = `esionage-import-${pending.length}-${Math.random().toString(36).slice(2)}`;
        pending.push({ path, token });
        return token;
      });
      for (const { path, token } of pending) {
        if (!uploads.has(path)) uploads.set(path, await store(userId, pageId, path, files.get(path)!, warnings, counts));
        const url = uploads.get(path);
        rewritten = rewritten.replace(token, url ?? encodeURI(relativeTo(node.source!, path)));
      }
      if (rewritten.trim()) await getCollab().replaceContent(pageId, liftImages(rewritten), actor);
    }
  } catch (error) {
    await discard(workspaceId, roots);
    throw error;
  }

  return {
    // Templates after the pages: they're not in the sidebar, so the pages are what to open first.
    pages: [...roots.filter((r) => !r.template), ...roots.filter((r) => r.template)].map((r) => ({
      id: r.id,
      title: r.title,
      kind: r.kind === "database" ? ("database" as const) : ("page" as const),
    })),
    created: counts,
    warnings: warnings.list,
    moreWarnings: warnings.more,
  };
}

/**
 * Which of a database's unclaimed rows a page of its folder is: the one of the same title (without
 * case), else, for a page titled the way the export titles untitled pages, a row with no title.
 */
function matchRow(rows: { title: string }[], title: string): number {
  const wanted = title.trim().toLowerCase();
  const same = rows.findIndex((r) => r.title.trim().toLowerCase() === wanted);
  if (same !== -1 || !UNTITLED.has(wanted)) return same;
  return rows.findIndex((r) => !r.title.trim());
}

/** A path as the link had it: relative to the file linking to it. */
function relativeTo(from: string, path: string) {
  const fromDir = from.split("/").slice(0, -1);
  const parts = path.split("/");
  let common = 0;
  while (common < fromDir.length && common < parts.length - 1 && fromDir[common] === parts[common]) common++;
  return [...fromDir.slice(common).map(() => ".."), ...parts.slice(common)].join("/");
}

/** Stores a file a page shows; null (and a warning) when it can't be. */
async function store(
  userId: string,
  pageId: string,
  path: string,
  data: Uint8Array,
  warnings: WarningList,
  counts: { files: number },
): Promise<string | null> {
  try {
    const stored = await uploadFile(userId, pageId, {
      name: path.slice(path.lastIndexOf("/") + 1),
      body: Readable.from([Buffer.from(data.buffer, data.byteOffset, data.byteLength)]),
      declaredSize: data.byteLength,
    });
    counts.files++;
    return stored.url;
  } catch (error) {
    if (error instanceof FileError && (error.code === "tooLarge" || error.code === "quotaExceeded")) {
      warnings.add({ code: "fileNotStored", path, reason: error.code });
      return null;
    }
    if (error instanceof AccessError) throw error;
    console.error(`[import] couldn't store ${path}`, error);
    warnings.add({ code: "fileNotStored", path, reason: "failed" });
    return null;
  }
}

/** Deletes what a failed import created: its top-level pages with everything under them. */
async function discard(workspaceId: string, roots: Created[]) {
  if (!roots.length) return;
  try {
    await db.delete(page).where(inArray(page.id, roots.map((r) => r.id)));
    getCollab().broadcast(`ws:${workspaceId}`, "tree");
    await removeOrphanFiles(workspaceId);
  } catch (error) {
    console.error("[import] couldn't take back a failed import", error);
  }
}
