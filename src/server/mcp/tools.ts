import { McpServer, type ScopeChallengeHandler } from "@modelcontextprotocol/server";
import * as z from "zod";
import { PROPERTY_TYPES } from "@/db/schema/app";
import { pageLabel } from "@/lib/labels";
import { getCollab, type WriteActor } from "@/server/collab/bridge";
import * as databases from "@/server/databases";
import * as pages from "@/server/pages";
import { MAX_MARKDOWN_CHARS, pageUrl, runTool, sliceText, ToolInputError } from "./format";
import { READ_SCOPE, WRITE_SCOPE, type McpPrincipal } from "./principal";
import {
  describeProperty,
  describeViewConfig,
  displayProperties,
  FILTER_OPS,
  toFilterRule,
  toSortRule,
  type PropertyDef,
} from "./query";

const INSTRUCTIONS = `esionage is a Notion-like workspace. Each user belongs to one or more workspaces.
Pages form a tree inside a workspace. A database is a special page whose children are rows; rows are pages with typed properties (text, number, select, multi_select, date, checkbox, url).
Start with list_workspaces or search to find ids, then get_page / list_pages / query_database.
Page bodies are read and written as Markdown. Before every content change esionage saves a history snapshot, so the user can undo your edits from the page history.
Always share the returned url with the user when you create or change something.`;

const id = (what: string) => z.string().min(1).describe(`The ${what} id (a UUID from another tool's output).`);

const rowValue = z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]);
const rowProperties = z
  .record(z.string(), rowValue)
  .describe(
    'Property values keyed by property name (case-insensitive) or id. Use option names for select / multi_select (an array for multi_select), ISO dates (YYYY-MM-DD) for date, true/false for checkbox, and null to clear a value. Example: {"Status": "In progress", "Tags": ["urgent"], "Due": "2026-10-01"}',
  );

/** Write tools advertise a step-up challenge so clients can re-authorize with pages:write. */
const requireWrite: ScopeChallengeHandler = ({ authInfo }) => {
  if (!authInfo || authInfo.scopes.includes(WRITE_SCOPE)) return undefined;
  const scopes = [...new Set([...authInfo.scopes, READ_SCOPE, WRITE_SCOPE])] as [string, ...string[]];
  return { scopes, errorDescription: "This tool needs the pages:write scope" };
};

const READ = { readOnlyHint: true, openWorldHint: false } as const;

export function createMcpServer(principal: McpPrincipal) {
  const server = new McpServer({ name: "esionage", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  const { userId } = principal;
  const actor: WriteActor = { userId, oauthClientId: principal.clientId };

  const assertWrite = () => {
    if (!principal.scopes.includes(WRITE_SCOPE)) {
      throw new ToolInputError(
        "This connection is read-only: the user did not grant the pages:write permission. Ask the user to reconnect esionage and allow editing.",
      );
    }
  };

  /** Loads a page with its database parent, if it is a row. */
  const loadPage = async (pageId: string) => {
    const page = await pages.getPage(userId, pageId);
    const parent = page.parentId ? await pages.getPage(userId, page.parentId).catch(() => null) : null;
    return { page, parentDatabase: parent?.kind === "database" ? parent : null };
  };

  const rowOutput = async (databaseId: string, rowId: string) => {
    const [{ database, properties }, row] = await Promise.all([
      databases.getDatabase(userId, databaseId),
      pages.getPage(userId, rowId),
    ]);
    return {
      id: row.id,
      title: pageLabel(row.title),
      database_id: databaseId,
      properties: displayProperties(properties, row.properties),
      url: pageUrl(database.workspaceId, row.id),
    };
  };

  const resolveLocation = async (workspaceId?: string, parentId?: string) => {
    if (parentId) {
      const parent = await pages.getPage(userId, parentId);
      if (parent.archivedAt) throw new ToolInputError("The parent page is in the trash. Choose another parent.");
      return { workspaceId: parent.workspaceId, parentId, parentKind: parent.kind };
    }
    if (!workspaceId) {
      throw new ToolInputError("Provide workspace_id (to create at the top level) or parent_id (to nest under a page).");
    }
    return { workspaceId, parentId: null, parentKind: null };
  };

  server.registerTool(
    "list_workspaces",
    {
      title: "List workspaces",
      description: "List the workspaces the user belongs to, with their ids. Use a workspace id with list_pages, search or create_page.",
      inputSchema: z.object({}),
      annotations: READ,
    },
    () =>
      runTool(async () => {
        const workspaces = await pages.listWorkspaces(userId);
        return { workspaces: workspaces.map((w) => ({ id: w.id, name: w.name, role: w.role })) };
      }),
  );

  server.registerTool(
    "search",
    {
      title: "Search pages",
      description:
        "Full-text search over page titles and bodies (including database rows) across the user's workspaces, best matches first. Returns ids, titles, a text snippet and a link.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Words to look for."),
        workspace_id: z.string().optional().describe("Only search this workspace."),
        limit: z.number().int().min(1).max(50).default(10).describe("Maximum results (1-50, default 10)."),
      }),
      annotations: READ,
    },
    ({ query, workspace_id, limit }) =>
      runTool(async () => {
        const hits = await pages.searchPages(userId, query, { workspaceId: workspace_id, limit });
        return {
          results: hits.map((h) => ({
            id: h.id,
            title: pageLabel(h.title),
            kind: h.kind,
            workspace_id: h.workspaceId,
            parent_id: h.parentId,
            snippet: h.snippet,
            updated_at: h.updatedAt.toISOString(),
            url: pageUrl(h.workspaceId, h.id),
          })),
        };
      }),
  );

  server.registerTool(
    "list_pages",
    {
      title: "List pages",
      description:
        "List the pages directly under a parent page, or the top-level pages of a workspace when parent_id is omitted. Trashed pages are excluded. For database rows prefer query_database.",
      inputSchema: z.object({
        workspace_id: id("workspace"),
        parent_id: z.string().optional().describe("Parent page id. Omit for the workspace's top-level pages."),
      }),
      annotations: READ,
    },
    ({ workspace_id, parent_id }) =>
      runTool(async () => {
        const children = await pages.listChildren(userId, workspace_id, parent_id ?? null);
        return {
          pages: children.map((c) => ({
            id: c.id,
            title: pageLabel(c.title),
            kind: c.kind,
            icon: c.icon,
            updated_at: c.updatedAt.toISOString(),
            url: pageUrl(workspace_id, c.id),
          })),
        };
      }),
  );

  server.registerTool(
    "get_page",
    {
      title: "Read a page",
      description: `Read a page: title, breadcrumb path, Markdown body, sub-pages and a link. For database rows it also returns the row's properties; for databases it returns the schema summary (use query_database for rows). Long bodies are cut at ${MAX_MARKDOWN_CHARS} characters; pass offset to continue reading.`,
      inputSchema: z.object({
        page_id: id("page"),
        offset: z.number().int().min(0).default(0).describe("Character offset into the Markdown body, for long pages."),
      }),
      annotations: READ,
    },
    ({ page_id, offset }) =>
      runTool(async () => {
        const { page, parentDatabase } = await loadPage(page_id);
        const [crumbs, content, workspaces] = await Promise.all([
          pages.getBreadcrumbs(userId, page_id),
          getCollab().readPage(page_id),
          pages.listWorkspaces(userId),
        ]);
        const workspace = workspaces.find((w) => w.id === page.workspaceId);
        const body = sliceText(content.markdown, offset);
        const out: Record<string, unknown> = {
          id: page.id,
          title: pageLabel(content.title || page.title),
          kind: page.kind,
          icon: page.icon,
          workspace_id: page.workspaceId,
          parent_id: page.parentId,
          path: [workspace?.name ?? "Workspace", ...crumbs.map((c) => pageLabel(c.title))].join(" / "),
          in_trash: Boolean(page.archivedAt),
          updated_at: page.updatedAt.toISOString(),
          url: pageUrl(page.workspaceId, page.id),
        };
        if (parentDatabase) {
          const { properties } = await databases.getDatabase(userId, parentDatabase.id);
          out.database_id = parentDatabase.id;
          out.properties = displayProperties(properties, page.properties);
        }
        if (page.kind === "database") {
          const { properties } = await databases.getDatabase(userId, page.id);
          out.database_properties = properties.map(describeProperty);
          out.note = "This is a database. Use query_database to list its rows and get_database for its full schema.";
        } else {
          out.markdown = body.text;
          if (body.truncated) {
            out.markdown_truncated = true;
            out.markdown_total_chars = body.totalChars;
            if ("note" in body) out.note = body.note;
          }
          const children = await pages.listChildren(userId, page.workspaceId, page.id);
          out.child_pages = children.slice(0, 100).map((c) => ({ id: c.id, title: pageLabel(c.title), kind: c.kind }));
          if (children.length > 100) out.child_pages_truncated = children.length;
        }
        return out;
      }),
  );

  server.registerTool(
    "create_page",
    {
      title: "Create a page",
      description:
        "Create a new page at the top level of a workspace (workspace_id) or nested under another page (parent_id), with an optional Markdown body. To add a row to a database use create_database_row instead.",
      inputSchema: z.object({
        workspace_id: z.string().optional().describe("Workspace for a top-level page. Ignored when parent_id is set."),
        parent_id: z.string().optional().describe("Page to nest the new page under."),
        title: z.string().min(1).max(500).describe("Page title."),
        markdown: z.string().optional().describe("Initial page body in Markdown."),
        icon: z.string().max(16).optional().describe("A single emoji used as the page icon."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      scopeChallenge: requireWrite,
    },
    ({ workspace_id, parent_id, title, markdown, icon }) =>
      runTool(async () => {
        assertWrite();
        const location = await resolveLocation(workspace_id, parent_id);
        if (location.parentKind === "database") {
          throw new ToolInputError("parent_id is a database. Use create_database_row to add rows to it.");
        }
        const created = await pages.createPage(actor, {
          workspaceId: location.workspaceId,
          parentId: location.parentId,
          title,
          icon: icon ?? null,
          markdown,
        });
        return {
          id: created.id,
          title: pageLabel(created.title),
          workspace_id: created.workspaceId,
          parent_id: created.parentId,
          url: pageUrl(created.workspaceId, created.id),
        };
      }),
  );

  server.registerTool(
    "update_page",
    {
      title: "Update a page",
      description:
        'Change a page\'s title and/or body. mode "replace" overwrites the whole body with the given Markdown; mode "append" adds it to the end. A history snapshot is saved before the body changes, and open editors update live. Works for database rows too (use update_database_row for their properties).',
      inputSchema: z.object({
        page_id: id("page"),
        title: z.string().min(1).max(500).optional().describe("New title."),
        markdown: z.string().optional().describe("Markdown to write into the body."),
        mode: z
          .enum(["replace", "append"])
          .default("replace")
          .describe('"replace" (default) overwrites the body; "append" adds to the end.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      scopeChallenge: requireWrite,
    },
    ({ page_id, title, markdown, mode }) =>
      runTool(async () => {
        assertWrite();
        if (title === undefined && markdown === undefined) throw new ToolInputError("Provide title and/or markdown.");
        const { page } = await loadPage(page_id);
        if (page.archivedAt) throw new ToolInputError("This page is in the trash. Restore it in esionage before editing.");
        const changed: string[] = [];
        if (markdown !== undefined) {
          if (page.kind === "database") {
            throw new ToolInputError("Databases have no text body. Use create_database_row or update_database_row.");
          }
          const collab = getCollab();
          if (mode === "append") await collab.appendContent(page_id, markdown, actor, true);
          else await collab.replaceContent(page_id, markdown, actor, true);
          changed.push(mode === "append" ? "body (appended)" : "body (replaced)");
        }
        if (title !== undefined) {
          await pages.renamePage(actor, page_id, title);
          changed.push("title");
        }
        return {
          id: page.id,
          changed,
          ...(markdown !== undefined ? { snapshot: "Saved the previous version to page history before writing." } : {}),
          url: pageUrl(page.workspaceId, page.id),
        };
      }),
  );

  server.registerTool(
    "archive_page",
    {
      title: "Move a page to the trash",
      description:
        "Move a page (with all its sub-pages, or a database with its rows) to the trash. This is reversible: the user can restore it from the trash in esionage.",
      inputSchema: z.object({ page_id: id("page") }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      scopeChallenge: requireWrite,
    },
    ({ page_id }) =>
      runTool(async () => {
        assertWrite();
        const page = await pages.getPage(userId, page_id);
        if (!page.archivedAt) await pages.archivePage(userId, page_id);
        return {
          id: page.id,
          title: pageLabel(page.title),
          in_trash: true,
          note: page.archivedAt
            ? "The page was already in the trash."
            : "Moved to the trash with its sub-pages. It can be restored from the trash in esionage.",
        };
      }),
  );

  server.registerTool(
    "get_database",
    {
      title: "Get a database schema",
      description:
        "Get a database's schema: its properties (name, type, and option names for select / multi_select), its views with their filters and sorts, and the row count. Call this before querying or writing rows.",
      inputSchema: z.object({ database_id: id("database") }),
      annotations: READ,
    },
    ({ database_id }) =>
      runTool(async () => {
        const [{ database, properties, views }, rows] = await Promise.all([
          databases.getDatabase(userId, database_id),
          databases.listRows(userId, database_id),
        ]);
        return {
          id: database.id,
          title: pageLabel(database.title),
          workspace_id: database.workspaceId,
          in_trash: Boolean(database.archivedAt),
          row_count: rows.length,
          properties: [
            { name: "title", type: "title", note: "Every row's title; filter and sort on it with property \"title\"." },
            ...properties.map(describeProperty),
          ],
          views: views.map((v) => ({ id: v.id, name: v.name, type: v.type, ...describeViewConfig(properties, v.config) })),
          url: pageUrl(database.workspaceId, database.id),
        };
      }),
  );

  server.registerTool(
    "query_database",
    {
      title: "Query database rows",
      description:
        'List rows of a database with optional filters and sorts. Filters reference properties by name (or "title", "created_at", "updated_at") and use select option names as values; all filters must match. Ops: contains, equals, not_equals, is_empty, is_not_empty, gt, lt. Returns property values by name.',
      inputSchema: z.object({
        database_id: id("database"),
        filters: z
          .array(
            z.object({
              property: z.string().min(1).describe("Property name or id, or title / created_at / updated_at."),
              op: z.enum(FILTER_OPS),
              value: z
                .union([z.string(), z.number(), z.boolean()])
                .optional()
                .describe("Comparison value; omit for is_empty / is_not_empty."),
            }),
          )
          .optional(),
        sorts: z
          .array(z.object({ property: z.string().min(1), direction: z.enum(["asc", "desc"]).default("asc") }))
          .optional(),
        view_id: z.string().optional().describe("Apply a saved view's filters and sorts first (ids from get_database)."),
        limit: z.number().int().min(1).max(200).default(50).describe("Maximum rows to return (1-200, default 50)."),
      }),
      annotations: READ,
    },
    ({ database_id, filters, sorts, view_id, limit }) =>
      runTool(async () => {
        const { database, properties, views } = await databases.getDatabase(userId, database_id);
        const props: PropertyDef[] = properties;
        const view = view_id ? views.find((v) => v.id === view_id) : undefined;
        if (view_id && !view) throw new ToolInputError(`No view with id "${view_id}" in this database.`);
        const rows = await databases.listRows(userId, database_id, {
          filters: [...(view?.config.filters ?? []), ...(filters ?? []).map((f) => toFilterRule(props, f))],
          sorts: sorts?.length ? sorts.map((s) => toSortRule(props, s)) : (view?.config.sorts ?? []),
        });
        return {
          database_id: database.id,
          title: pageLabel(database.title),
          total: rows.length,
          returned: Math.min(rows.length, limit),
          rows: rows.slice(0, limit).map((r) => ({
            id: r.id,
            title: pageLabel(r.title),
            properties: displayProperties(props, r.properties),
            url: pageUrl(database.workspaceId, r.id),
          })),
          ...(rows.length > limit ? { note: `Only the first ${limit} rows are shown; narrow the filters or raise limit.` } : {}),
        };
      }),
  );

  server.registerTool(
    "create_database_row",
    {
      title: "Add a database row",
      description:
        "Add a row to a database with a title, property values (by property name, select options by name) and an optional Markdown body. Call get_database first to learn the property names and options.",
      inputSchema: z.object({
        database_id: id("database"),
        title: z.string().min(1).max(500).describe("Row title."),
        properties: rowProperties.optional(),
        markdown: z.string().optional().describe("Optional Markdown body for the row's page."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      scopeChallenge: requireWrite,
    },
    ({ database_id, title, properties, markdown }) =>
      runTool(async () => {
        assertWrite();
        const { database } = await databases.getDatabase(userId, database_id);
        if (database.archivedAt) throw new ToolInputError("This database is in the trash.");
        const created = await pages.createPage(actor, {
          workspaceId: database.workspaceId,
          parentId: database.id,
          title,
          properties: properties ?? {},
          markdown,
        });
        return rowOutput(database.id, created.id);
      }),
  );

  server.registerTool(
    "update_database_row",
    {
      title: "Update a database row",
      description:
        "Change a database row's title and/or property values (by property name, select options by name, null clears a value). Properties not mentioned keep their values. To change the row's body use update_page.",
      inputSchema: z.object({
        row_id: id("row"),
        title: z.string().min(1).max(500).optional().describe("New row title."),
        properties: rowProperties.optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      scopeChallenge: requireWrite,
    },
    ({ row_id, title, properties }) =>
      runTool(async () => {
        assertWrite();
        if (title === undefined && !properties) throw new ToolInputError("Provide title and/or properties.");
        const { page, parentDatabase } = await loadPage(row_id);
        if (!parentDatabase) throw new ToolInputError("This page is not a database row. Use update_page for regular pages.");
        if (page.archivedAt) throw new ToolInputError("This row is in the trash.");
        if (properties && Object.keys(properties).length) await databases.updateRowProperties(userId, row_id, properties);
        if (title !== undefined) await pages.renamePage(actor, row_id, title);
        const out = await rowOutput(parentDatabase.id, row_id);
        // The rename lands in the live document first; report the new title right away.
        return title !== undefined ? { ...out, title } : out;
      }),
  );

  server.registerTool(
    "create_database",
    {
      title: "Create a database",
      description:
        'Create a new database (a table of rows) at the top level of a workspace or under a page. It starts with a "Status" select (Not started, In progress, Done) and a "Tags" multi-select; add more with add_database_property.',
      inputSchema: z.object({
        workspace_id: z.string().optional().describe("Workspace for a top-level database. Ignored when parent_id is set."),
        parent_id: z.string().optional().describe("Page to create the database under."),
        title: z.string().min(1).max(500).describe("Database title."),
        icon: z.string().max(16).optional().describe("A single emoji used as the icon."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      scopeChallenge: requireWrite,
    },
    ({ workspace_id, parent_id, title, icon }) =>
      runTool(async () => {
        assertWrite();
        const location = await resolveLocation(workspace_id, parent_id);
        if (location.parentKind === "database") throw new ToolInputError("A database cannot be created inside another database.");
        const created = await pages.createPage(actor, {
          workspaceId: location.workspaceId,
          parentId: location.parentId,
          kind: "database",
          title,
          icon: icon ?? null,
        });
        const { properties } = await databases.getDatabase(userId, created.id);
        return {
          id: created.id,
          title: pageLabel(created.title),
          workspace_id: created.workspaceId,
          properties: properties.map(describeProperty),
          url: pageUrl(created.workspaceId, created.id),
        };
      }),
  );

  server.registerTool(
    "add_database_property",
    {
      title: "Add a database property",
      description:
        "Add a property (column) to a database. For select and multi_select, pass the option names; other types ignore options.",
      inputSchema: z.object({
        database_id: id("database"),
        name: z.string().min(1).max(100).describe("Property name; must be unique within the database."),
        type: z.enum(PROPERTY_TYPES),
        options: z.array(z.string().min(1)).max(100).optional().describe("Option names for select / multi_select."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      scopeChallenge: requireWrite,
    },
    ({ database_id, name, type, options }) =>
      runTool(async () => {
        assertWrite();
        const { properties } = await databases.getDatabase(userId, database_id);
        const needle = name.trim().toLowerCase();
        if (needle === "title" || properties.some((p) => p.name.trim().toLowerCase() === needle)) {
          throw new ToolInputError(`A property named "${name}" already exists in this database.`);
        }
        const unique = options ? [...new Map(options.map((o) => [o.trim().toLowerCase(), o.trim()])).values()] : undefined;
        const created = await databases.addProperty(userId, database_id, { name, type, options: unique });
        return { database_id, property: describeProperty(created) };
      }),
  );

  return server;
}
