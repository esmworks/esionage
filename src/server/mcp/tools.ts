import { McpServer, type ScopeChallengeHandler } from "@modelcontextprotocol/server";
import * as z from "zod";
import {
  PROPERTY_TYPES,
  type FilterCombinator,
  type SelectOption,
  type StatusGroup,
  type ViewConfig,
  type ViewType,
} from "@/db/schema/app";
import { FILTER_COMBINATORS, MAX_FILTER_DEPTH, MAX_RELATIVE_DAYS, RELATIVE_DATE_RANGES } from "@/lib/filters";
import { formulaForStorage, withFormulaTypes } from "@/lib/derived";
import { MAX_FORMULA_LENGTH } from "@/lib/formula";
import { GROUP_DATE_BY } from "@/lib/grouping";
import { pageLabel } from "@/lib/labels";
import { isGroupable, sortStatusOptions, statusColor } from "@/lib/properties";
import { holdsOptions, holdsTimestamp, STATUS_GROUPS } from "@/lib/property-types";
import { getCollab, type WriteActor } from "@/server/collab/bridge";
import * as databases from "@/server/databases";
import * as notifications from "@/server/notifications";
import * as pages from "@/server/pages";
import * as workspaces from "@/server/workspaces";
import { MAX_MARKDOWN_CHARS, pageUrl, runTool, sliceText, ToolInputError } from "./format";
import { NOTIFICATIONS_SCOPE, READ_SCOPE, WRITE_SCOPE, type McpPrincipal } from "./principal";
import {
  describeProperty,
  describeViewConfig,
  displayProperties,
  FILTER_OPS,
  resolvePropertyKey,
  toFilterEntries,
  toSortRule,
  type FilterEntryInput,
  type PropertyDef,
  type Lookups,
  type SortInput,
} from "./query";

const INSTRUCTIONS = `Esionage is a Notion-like workspace. Each user belongs to one or more workspaces.
Pages form a tree inside a workspace. A database is a special page whose children are rows; rows are pages with typed properties (text, number, select, multi_select, status, date, checkbox, url, email, phone, checklist, relation, person, created_by, created_time, last_edited_by, last_edited_time, formula). A relation links rows to rows of another database in the same workspace; two-way relations show the links on both databases. A person property assigns rows to people of the workspace; "me" stands for the signed-in user. A status is a select whose options belong to the groups todo, in_progress and done. A checklist holds items that can be ticked off. created_by, created_time, last_edited_by and last_edited_time show who created or last edited each row and when; they are filled in automatically and can't be written. A formula property computes its value from the row's other properties (see add_database_property); it can't be written either.
Start with list_workspaces or search to find ids, then get_page / list_pages / query_database.
Page bodies are read and written as Markdown. Before every content change Esionage saves a history snapshot, so the user can undo your edits from the page history (list_page_history / restore_page_version).
list_notifications shows the user's inbox: rows someone assigned them to and pages shared with them.
Always share the returned url with the user when you create or change something.`;

const MAX_BULK_ROWS = 100;

const id = (what: string) => z.string().min(1).describe(`The ${what} id (a UUID from another tool's output).`);

const checklistItem = z.object({ text: z.string(), checked: z.boolean().optional() });
const rowValue = z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), checklistItem])), z.null()]);
const rowProperties = z
  .record(z.string(), rowValue)
  .describe(
    'Property values keyed by property name (case-insensitive) or id. Use option names for select / multi_select / status (an array for multi_select), ISO dates (YYYY-MM-DD) for date, true/false for checkbox, an email address for email, a phone number for phone, an array of item texts or {text, checked} objects for checklist, an array of row ids (or exact row titles) of the related database for relation, an array of user ids, emails, names or "me" for person, and null to clear a value. Setting a relation, person or checklist replaces its values. created_by, created_time, last_edited_by, last_edited_time and formula properties are read-only. Example: {"Status": "In progress", "Tags": ["urgent"], "Due": "2026-10-01", "Customer": ["Acme Ltd"], "Assignee": ["me"]}',
  );

/** How formulas are written, for tool descriptions. */
const FORMULA_HELP =
  'Reference properties with prop("Name") (prop("title") is the row title). Operators: + - * / % ^, == != < <= > >=, and or not; "+" also joins text. Functions: if, ifs, empty, and, or, not; concat, length, lower, upper, trim, contains, startsWith, endsWith, replace, replaceAll, slice, join, format; round, floor, ceil, abs, sqrt, sign, pow, min, max; toNumber, parseDate; now, today, dateAdd, dateSubtract, dateBetween (units: years, quarters, months, weeks, days, hours, minutes, seconds), formatDate (tokens YYYY MM DD HH mm…), year, month, day, weekday, hour, minute, timestamp. Select and status read as their option name; multi-select, relation and person as lists; checklists as the share of ticked items; dates work in UTC. Invalid formulas are refused with the reason. Formula values are read-only; query_database returns them and can filter and sort on them like values of their result type.';
const formulaInput = z.string().max(MAX_FORMULA_LENGTH);

const filterRuleInput = z.object({
  property: z.string().min(1).describe("Property name or id, or title / created_at / updated_at."),
  op: z.enum(FILTER_OPS),
  value: z
    .union([z.string(), z.number(), z.boolean()])
    .optional()
    .describe(`Comparison value; omit for is_empty / is_not_empty. For is_within: ${RELATIVE_DATE_RANGES.join(", ")}.`),
  days: z
    .number()
    .int()
    .min(1)
    .max(MAX_RELATIVE_DAYS)
    .optional()
    .describe("is_within with past_n_days / next_n_days only: how many days back or ahead of today."),
});
const combinatorInput = z.enum(FILTER_COMBINATORS);
const filterGroupInput = <T extends z.ZodType>(rules: T) =>
  z.object({
    type: z.literal("group"),
    combinator: combinatorInput.default("and").describe("How the group's rules combine."),
    rules: z.array(rules).min(1),
  });
/**
 * A rule or a group. When neither fits, the error names what is wrong with the one the input was
 * meant to be (a plain union only says "Invalid input"), e.g. an unknown op.
 */
const ruleOrGroup = <G extends z.ZodType>(group: G) =>
  z.union([filterRuleInput, group], {
    error: (issue) => {
      if (issue.code !== "invalid_union" || !issue.errors.length) return undefined;
      const input = issue.input as { type?: unknown } | null | undefined;
      const branch = issue.errors[input?.type === "group" ? 1 : 0] ?? [];
      return branch.map((e) => `${e.path.length ? `${e.path.join(".")}: ` : ""}${e.message}`).join("; ") || undefined;
    },
  });
// Spelled out level by level (instead of a recursive schema) so every MCP client can read it. A
// group nested deeper than MAX_FILTER_DEPTH still parses at the innermost level and is then
// rejected by toFilterEntries with a message saying so.
const deepestGroup = z.object({ type: z.literal("group") }).loose();
const filtersInput = z
  .array(ruleOrGroup(filterGroupInput(ruleOrGroup(filterGroupInput(ruleOrGroup(deepestGroup))))))
  .describe(
    `Filter rules and groups. A rule is {property, op, value}; a group is {type: "group", combinator: "and" | "or", rules: [...]}; groups may hold groups, at most ${MAX_FILTER_DEPTH} levels deep. A plain list of rules keeps working.`,
  );
const filterCombinatorInput = combinatorInput
  .optional()
  .describe('How the top-level filters combine: "and" (default, all must match) or "or" (any may match).');
const sortsInput = z.array(z.object({ property: z.string().min(1), direction: z.enum(["asc", "desc"]).default("asc") }));

/** Resolves a property by name or id; title / created_at / updated_at are not editable properties. */
function requireProperty<P extends PropertyDef>(props: P[], ref: string): P {
  const { prop } = resolvePropertyKey(props, ref);
  if (!prop) throw new ToolInputError(`"${ref}" is a built-in field, not a database property.`);
  return prop as P;
}

/** Option names, or for status properties names with the group they belong to. */
const optionsInput = z
  .array(z.union([z.string().min(1), z.object({ name: z.string().min(1), group: z.enum(STATUS_GROUPS) })]))
  .max(100);
type OptionEntry = z.infer<typeof optionsInput>[number];
const optionName = (o: OptionEntry) => (typeof o === "string" ? o : o.name).trim();

/**
 * Applies option removals, renames, additions and (status only) group moves by name, in that
 * order. New status options join the group given with them, or to do.
 */
function editOptions(
  prop: { name: string; type: string },
  current: SelectOption[],
  changes: {
    add: OptionEntry[];
    rename: { from: string; to: string }[];
    remove: string[];
    groups?: { option: string; group: StatusGroup }[];
  },
) {
  const propName = prop.name;
  let options = [...current];
  const find = (name: string) => options.find((o) => o.name.trim().toLowerCase() === name.trim().toLowerCase());
  const missing = (name: string) =>
    new ToolInputError(
      `"${name}" is not an option of "${propName}". Options: ${options.map((o) => o.name).join(", ") || "none"}`,
    );
  for (const name of changes.remove) {
    const option = find(name);
    if (!option) throw missing(name);
    options = options.filter((o) => o.id !== option.id);
  }
  for (const { from, to } of changes.rename) {
    const option = find(from);
    if (!option) throw missing(from);
    const clash = find(to);
    if (clash && clash.id !== option.id) throw new ToolInputError(`"${propName}" already has an option named "${clash.name}".`);
    options = options.map((o) => (o.id === option.id ? { ...o, name: to.trim() } : o));
  }
  for (const entry of changes.add) {
    const name = optionName(entry);
    if (find(name)) continue;
    if (prop.type !== "status") options.push(databases.makeOption(name, options.length));
    else {
      const group = typeof entry === "string" ? "todo" : entry.group;
      options.push({ ...databases.makeOption(name), color: statusColor(group), group });
    }
  }
  for (const { option: name, group } of changes.groups ?? []) {
    const option = find(name);
    if (!option) throw missing(name);
    options = options.map((o) => (o.id === option.id ? { ...o, group } : o));
  }
  return prop.type === "status" ? sortStatusOptions(options) : options;
}

type ViewInput = {
  group_by?: string | null;
  group_date_by?: (typeof GROUP_DATE_BY)[number];
  group_status_by?: "option" | "group";
  hide_empty_groups?: boolean;
  date_by?: string;
  filters?: FilterEntryInput[];
  filter_combinator?: FilterCombinator;
  sorts?: SortInput[];
};

/** How a board or table groups, besides the property it groups by. */
const groupSettingsInput = {
  group_date_by: z
    .enum(GROUP_DATE_BY)
    .optional()
    .describe("Grouping by a date, created_time or last_edited_time: one group per day, week (Monday to Sunday), month (the default) or year."),
  group_status_by: z
    .enum(["option", "group"])
    .optional()
    .describe('Grouping by a status: one group per option (the default) or per status group ("group": todo, in_progress, done).'),
  hide_empty_groups: z.boolean().optional().describe("Leave out groups without rows."),
};

/** The view settings the caller asked to change, converted from names to stored ids. */
function viewConfigPatch(props: PropertyDef[], type: ViewType, input: ViewInput, lookups: Lookups): ViewConfig {
  const patch: ViewConfig = {};
  const grouped = type === "board" || type === "table";
  if (input.group_by !== undefined) {
    if (!grouped) throw new ToolInputError("group_by only applies to board and table views.");
    if (input.group_by === null) {
      if (type === "board") throw new ToolInputError("Boards always group their cards; pass a property to group by.");
      patch.groupBy = undefined;
    } else {
      const prop = requireProperty(props, input.group_by);
      if (!isGroupable(prop.type)) {
        throw new ToolInputError(
          `Views group by a select, status, multi_select, person, created_by, last_edited_by, checkbox, date, created_time, last_edited_time or relation property; "${prop.name}" is ${prop.type}.`,
        );
      }
      patch.groupBy = prop.id;
      if (input.group_date_by && prop.type !== "date" && !holdsTimestamp(prop.type)) {
        throw new ToolInputError(`group_date_by only applies when grouping by a date; "${prop.name}" is ${prop.type}.`);
      }
      if (input.group_status_by && prop.type !== "status") {
        throw new ToolInputError(`group_status_by only applies when grouping by a status; "${prop.name}" is ${prop.type}.`);
      }
    }
  }
  const groupSettings = input.group_date_by ?? input.group_status_by ?? input.hide_empty_groups;
  if (groupSettings !== undefined && !grouped) {
    throw new ToolInputError("group_date_by, group_status_by and hide_empty_groups only apply to board and table views.");
  }
  if (input.group_date_by) patch.groupDateBy = input.group_date_by;
  if (input.group_status_by) patch.groupStatusBy = input.group_status_by === "group" ? "group" : undefined;
  if (input.hide_empty_groups !== undefined) patch.hideEmptyGroups = input.hide_empty_groups || undefined;
  if (input.date_by !== undefined) {
    if (type !== "calendar") throw new ToolInputError("date_by only applies to calendar views.");
    const prop = requireProperty(props, input.date_by);
    if (prop.type !== "date") throw new ToolInputError(`Calendars place rows by a date property; "${prop.name}" is ${prop.type}.`);
    patch.dateBy = prop.id;
  }
  if (input.filters) patch.filters = toFilterEntries(props, input.filters, lookups);
  // New filters replace the old ones together with how they combine ("and" unless given).
  if (input.filters || input.filter_combinator) {
    patch.filterCombinator = input.filter_combinator === "or" ? "or" : undefined;
  }
  if (input.sorts) patch.sorts = input.sorts.map((s) => toSortRule(props, s));
  return patch;
}

function viewOutput(
  database: { id: string; workspaceId: string },
  props: PropertyDef[],
  view: { id: string; name: string; type: ViewType; config: ViewConfig },
  lookups: Lookups,
) {
  return {
    id: view.id,
    name: view.name,
    type: view.type,
    database_id: database.id,
    ...describeViewConfig(props, view.config, lookups),
    url: pageUrl(database.workspaceId, database.id),
  };
}

/** Write tools advertise a step-up challenge so clients can re-authorize with pages:write. */
const requireWrite: ScopeChallengeHandler = ({ authInfo }) => {
  if (!authInfo || authInfo.scopes.includes(WRITE_SCOPE)) return undefined;
  const scopes = [...new Set([...authInfo.scopes, READ_SCOPE, WRITE_SCOPE])] as [string, ...string[]];
  return { scopes, errorDescription: "This tool needs the pages:write scope" };
};

/** The inbox tool advertises a step-up challenge for notifications:read the same way. */
const requireNotifications: ScopeChallengeHandler = ({ authInfo }) => {
  if (!authInfo || authInfo.scopes.includes(NOTIFICATIONS_SCOPE)) return undefined;
  const scopes = [...new Set([...authInfo.scopes, READ_SCOPE, NOTIFICATIONS_SCOPE])] as [string, ...string[]];
  return { scopes, errorDescription: "This tool needs the notifications:read scope" };
};

const READ = { readOnlyHint: true, openWorldHint: false } as const;

export function createMcpServer(principal: McpPrincipal) {
  const server = new McpServer({ name: "esionage", title: "Esionage", version: "0.2.0" }, { instructions: INSTRUCTIONS });
  const { userId } = principal;
  const actor: WriteActor = { userId, oauthClientId: principal.clientId };

  const assertWrite = () => {
    if (!principal.scopes.includes(WRITE_SCOPE)) {
      throw new ToolInputError(
        "This connection is read-only: the user did not grant the pages:write permission. Ask the user to reconnect Esionage and allow editing.",
      );
    }
  };

  /** Loads a page with its parent, when the user can see it, and its database, if it is a row. */
  const loadPage = async (pageId: string) => {
    const page = await pages.getPage(userId, pageId);
    const parent = page.parentId ? await pages.getPage(userId, page.parentId).catch(() => null) : null;
    return { page, parent, parentDatabase: parent?.kind === "database" ? parent : null };
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
      properties: displayProperties(
        properties,
        await databases.rowValues(userId, row, properties),
        await databases.getLookups(userId, properties),
      ),
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
    "list_notifications",
    {
      title: "List notifications",
      description:
        "List the user's inbox, newest first: database rows someone assigned them to and pages someone shared with them, with who did it and a link. Only the kinds the user keeps in their inbox are listed. Reading does not mark them read.",
      inputSchema: z.object({
        workspace_id: z.string().optional().describe("Only this workspace; all of the user's workspaces when omitted."),
        unread_only: z.boolean().default(false).describe("Only notifications the user hasn't read yet."),
        limit: z.number().int().min(1).max(50).default(20).describe("Maximum results (1-50, default 20)."),
      }),
      annotations: READ,
      scopeChallenge: requireNotifications,
    },
    ({ workspace_id, unread_only, limit }) =>
      runTool(async () => {
        if (!principal.scopes.includes(NOTIFICATIONS_SCOPE)) {
          throw new ToolInputError(
            "This connection can't read notifications: the user did not grant the notifications:read permission. Ask the user to reconnect Esionage and allow it.",
          );
        }
        const items = await notifications.listNotifications(userId, { workspaceId: workspace_id, unreadOnly: unread_only, limit });
        return {
          notifications: items.map((n) => {
            const who = n.actorName || "Someone";
            const title = pageLabel(n.pageTitle);
            return {
              id: n.id,
              kind: n.kind,
              read: n.read,
              created_at: n.createdAt.toISOString(),
              summary:
                n.kind === "assignment"
                  ? `${who} assigned the user to "${n.propertyName ?? ""}" on "${title}" in ${pageLabel(n.databaseTitle)}`
                  : `${who} shared "${title}" with the user`,
              actor: n.actorName,
              page_id: n.pageId,
              title,
              ...(n.kind === "assignment" ? { database: pageLabel(n.databaseTitle), property: n.propertyName } : {}),
              workspace_id: n.workspaceId,
              workspace_name: n.workspaceName,
              url: pageUrl(n.workspaceId, n.pageId),
            };
          }),
        };
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
        const { page, parent, parentDatabase } = await loadPage(page_id);
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
          // A parent they can't see stays unnamed, id included.
          parent_id: parent?.id ?? null,
          path: [workspace?.name ?? "Workspace", ...crumbs.map((c) => pageLabel(c.title))].join(" / "),
          in_trash: Boolean(page.archivedAt),
          updated_at: page.updatedAt.toISOString(),
          url: pageUrl(page.workspaceId, page.id),
        };
        if (parentDatabase) {
          const { properties } = await databases.getDatabase(userId, parentDatabase.id);
          out.database_id = parentDatabase.id;
          out.properties = displayProperties(
            properties,
            await databases.rowValues(userId, page, properties),
            await databases.getLookups(userId, properties),
          );
        }
        if (page.kind === "database") {
          const { properties } = await databases.getDatabase(userId, page.id);
          const lookups = await databases.getLookups(userId, properties);
          out.database_properties = properties.map((p) => describeProperty(p, lookups, properties));
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
        if (page.archivedAt) throw new ToolInputError("This page is in the trash. Restore it in Esionage before editing.");
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
        "Move a page (with all its sub-pages, or a database with its rows) to the trash. This is reversible: the user can restore it from the trash in Esionage.",
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
            : "Moved to the trash with its sub-pages. It can be restored from the trash in Esionage.",
        };
      }),
  );

  server.registerTool(
    "get_database",
    {
      title: "Get a database schema",
      description:
        "Get a database's schema: its properties (name, type, option names for select / multi_select / status with the status groups, and the people a person property can hold), its views with their filters, sorts and grouping, and the row count. Call this before querying or writing rows.",
      inputSchema: z.object({ database_id: id("database") }),
      annotations: READ,
    },
    ({ database_id }) =>
      runTool(async () => {
        const [{ database, properties, views }, rows] = await Promise.all([
          databases.getDatabase(userId, database_id),
          databases.listRows(userId, database_id),
        ]);
        const lookups = await databases.getLookups(userId, properties);
        return {
          id: database.id,
          title: pageLabel(database.title),
          workspace_id: database.workspaceId,
          in_trash: Boolean(database.archivedAt),
          row_count: rows.length,
          properties: [
            { name: "title", type: "title", note: "Every row's title; filter and sort on it with property \"title\"." },
            ...properties.map((p) => describeProperty(p, lookups, properties)),
          ],
          views: views.map((v) => ({ id: v.id, name: v.name, type: v.type, ...describeViewConfig(properties, v.config, lookups) })),
          url: pageUrl(database.workspaceId, database.id),
        };
      }),
  );

  server.registerTool(
    "query_database",
    {
      title: "Query database rows",
      description:
        'List rows of a database with optional filters and sorts. Filters reference properties by name (or "title", "created_at", "updated_at") and use select / status option names as values; by default all filters must match, filter_combinator "or" lets any match, and groups ({type: "group", combinator, rules}) mix the two, e.g. Status is Done and (Assignee contains me or Priority is High). Ops: contains, equals, not_equals, is_empty, is_not_empty, gt, lt, is_within. For a relation use contains / not_equals with a related row id or title; for a person, created_by or last_edited_by, contains / not_equals with a user id, email, name or "me". For dates, created_time and last_edited_time, equals (that day), gt (after) and lt (before) take a YYYY-MM-DD date, and is_within takes today, this_week (Monday to Sunday), this_month, or past_n_days / next_n_days with "days" (both include today), counted from the current date on the server. Checklists only support is_empty / is_not_empty. Sorting by a person orders rows by name, a status by its groups, a checklist by the share of ticked items. Returns property values by name; relations as [{id, title}], people as [{id, name}], checklists as [{text, checked}].',
      inputSchema: z.object({
        database_id: id("database"),
        filters: filtersInput.optional(),
        filter_combinator: filterCombinatorInput,
        sorts: sortsInput.optional(),
        view_id: z
          .string()
          .optional()
          .describe("Apply a saved view's filters and sorts first (ids from get_database); rows must match both the view's filters and yours."),
        limit: z.number().int().min(1).max(200).default(50).describe("Maximum rows to return (1-200, default 50)."),
      }),
      annotations: READ,
    },
    ({ database_id, filters, filter_combinator, sorts, view_id, limit }) =>
      runTool(async () => {
        const { database, properties, views } = await databases.getDatabase(userId, database_id);
        const props: PropertyDef[] = properties;
        const lookups = await databases.getLookups(userId, properties);
        const view = view_id ? views.find((v) => v.id === view_id) : undefined;
        if (view_id && !view) throw new ToolInputError(`No view with id "${view_id}" in this database.`);
        // The view's filters and the caller's each keep their own combinator; rows must match both.
        const own = { type: "group", combinator: filter_combinator ?? "and", rules: toFilterEntries(props, filters ?? [], lookups) } as const;
        const saved = { type: "group", combinator: view?.config.filterCombinator ?? "and", rules: view?.config.filters ?? [] } as const;
        const rows = await databases.listRows(userId, database_id, {
          filters: [saved, own].filter((g) => g.rules.length),
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
            properties: displayProperties(props, r.properties, lookups),
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
    "create_database_rows",
    {
      title: "Add many database rows",
      description: `Add up to ${MAX_BULK_ROWS} rows to a database in one call, in the given order, each with a title, property values and an optional Markdown body (same format as create_database_row). All rows are checked first: if any value is invalid nothing is created and the error names the row. Use this to import or migrate data; split larger imports into batches.`,
      inputSchema: z.object({
        database_id: id("database"),
        rows: z
          .array(
            z.object({
              title: z.string().min(1).max(500).describe("Row title."),
              properties: rowProperties.optional(),
              markdown: z.string().optional().describe("Optional Markdown body for the row's page."),
            }),
          )
          .min(1)
          .max(MAX_BULK_ROWS)
          .describe(`The rows to add (1-${MAX_BULK_ROWS}).`),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      scopeChallenge: requireWrite,
    },
    ({ database_id, rows }) =>
      runTool(async () => {
        assertWrite();
        const { database } = await databases.getDatabase(userId, database_id);
        if (database.archivedAt) throw new ToolInputError("This database is in the trash.");
        const created = await databases.createRows(userId, database.id, rows);
        const collab = getCollab();
        for (const [i, row] of created.entries()) {
          const markdown = rows[i].markdown;
          if (markdown?.trim()) await collab.replaceContent(row.id, markdown, actor);
        }
        return {
          database_id: database.id,
          created: created.length,
          rows: created.map((r) => ({ id: r.id, title: pageLabel(r.title), url: pageUrl(database.workspaceId, r.id) })),
          url: pageUrl(database.workspaceId, database.id),
        };
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
    "update_database_rows",
    {
      title: "Update many database rows",
      description: `Set the same property values on up to ${MAX_BULK_ROWS} rows of one database (same value format as update_database_row). Values are checked first: if one is invalid nothing changes. Rows the user can't edit are skipped and listed in skipped_row_ids.`,
      inputSchema: z.object({
        database_id: id("database"),
        row_ids: z.array(z.string().min(1)).min(1).max(MAX_BULK_ROWS).describe(`Ids of the rows to change (1-${MAX_BULK_ROWS}).`),
        properties: rowProperties,
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      scopeChallenge: requireWrite,
    },
    ({ database_id, row_ids, properties }) =>
      runTool(async () => {
        assertWrite();
        if (!Object.keys(properties).length) throw new ToolInputError("Provide at least one property value.");
        const { database } = await databases.getDatabase(userId, database_id);
        if (database.archivedAt) throw new ToolInputError("This database is in the trash.");
        const { done, skipped } = await databases.updateRowsProperties(userId, database.id, row_ids, properties);
        return {
          database_id: database.id,
          updated: done.length,
          ...(skipped.length ? { skipped_row_ids: skipped } : {}),
          url: pageUrl(database.workspaceId, database.id),
        };
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
          properties: properties.map((p) => describeProperty(p)),
          url: pageUrl(created.workspaceId, created.id),
        };
      }),
  );

  server.registerTool(
    "add_database_property",
    {
      title: "Add a database property",
      description:
        `Add a property (column) to a database. For select and multi_select, pass the option names. For status, pass option names (spread over the groups: the first is todo, the last done, the ones between in_progress) or {name, group} objects; without options a status gets Not started, In progress and Done. Other types ignore options. For a relation, pass related_database_id (a database in the same workspace, or this one); with two_way the related database also gets a property listing the links back. created_by, created_time, last_edited_by and last_edited_time properties fill themselves in with who created or last edited each row and when. A formula computes its value from the row's other properties: pass the expression in formula. ${FORMULA_HELP}`,
      inputSchema: z.object({
        database_id: id("database"),
        name: z.string().min(1).max(100).describe("Property name; must be unique within the database."),
        type: z.enum(PROPERTY_TYPES),
        options: optionsInput.optional().describe("Option names for select / multi_select / status; {name, group} objects for status."),
        related_database_id: z.string().optional().describe("Relation only: the database whose rows this property links to."),
        two_way: z.boolean().default(false).describe("Relation only: also show the links on the related database."),
        paired_property_name: z
          .string()
          .min(1)
          .max(100)
          .optional()
          .describe("Relation with two_way only: name of the property added to the related database. Defaults to this database's title."),
        formula: formulaInput.optional().describe('Formula only: the expression, e.g. prop("Price") * prop("Quantity").'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      scopeChallenge: requireWrite,
    },
    ({ database_id, name, type, options, related_database_id, two_way, paired_property_name, formula }) =>
      runTool(async () => {
        assertWrite();
        if (type === "relation" && !related_database_id) throw new ToolInputError("A relation needs related_database_id.");
        if (type !== "relation" && (related_database_id || paired_property_name)) {
          throw new ToolInputError("related_database_id and paired_property_name only apply to relation properties.");
        }
        if (type === "formula" && !formula?.trim()) throw new ToolInputError("A formula property needs formula, its expression.");
        if (type !== "formula" && formula !== undefined) throw new ToolInputError("formula only applies to formula properties.");
        const { properties } = await databases.getDatabase(userId, database_id);
        const needle = name.trim().toLowerCase();
        if (needle === "title" || properties.some((p) => p.name.trim().toLowerCase() === needle)) {
          throw new ToolInputError(`A property named "${name}" already exists in this database.`);
        }
        // Only status options carry a group; other types take the names.
        const entry = (o: OptionEntry) => (type === "status" && typeof o !== "string" ? { ...o, name: optionName(o) } : optionName(o));
        const unique = options ? [...new Map(options.map((o) => [optionName(o).toLowerCase(), entry(o)])).values()] : undefined;
        const created = await databases.addProperty(userId, database_id, {
          name,
          type,
          options: unique,
          ...(type === "relation"
            ? { relation: { databaseId: related_database_id!, twoWay: two_way, pairedName: paired_property_name } }
            : {}),
          ...(type === "formula" ? { formula: { expression: formula! } } : {}),
        });
        // Formulas come with their result type.
        const after = withFormulaTypes([...properties, created]);
        const shown = after[after.length - 1];
        const lookups = await databases.getLookups(userId, [shown]);
        return { database_id, property: describeProperty(shown, lookups, after) };
      }),
  );

  server.registerTool(
    "update_database_property",
    {
      title: "Update a database property",
      description:
        "Rename a database property, change the options of a select / multi_select / status property (add, rename or remove options by name; for status also move options between the todo, in_progress and done groups) and/or change a formula's expression. Renaming an option keeps it on every row that uses it; removing one clears it from those rows. Renaming a property keeps the formulas that use it working.",
      inputSchema: z.object({
        database_id: id("database"),
        property: z.string().min(1).describe("Current property name or id."),
        name: z.string().min(1).max(100).optional().describe("New property name."),
        add_options: optionsInput
          .optional()
          .describe("Option names to add (existing names are skipped); for status, {name, group} objects (plain names join todo)."),
        rename_options: z
          .array(z.object({ from: z.string().min(1), to: z.string().min(1) }))
          .max(100)
          .optional()
          .describe("Options to rename, by current name."),
        remove_options: z.array(z.string().min(1)).max(100).optional().describe("Option names to remove."),
        option_groups: z
          .array(z.object({ option: z.string().min(1), group: z.enum(STATUS_GROUPS) }))
          .max(100)
          .optional()
          .describe("Status only: options to move to another group, by name."),
        formula: formulaInput.optional().describe(`Formula only: the new expression. ${FORMULA_HELP}`),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      scopeChallenge: requireWrite,
    },
    ({ database_id, property, name, add_options, rename_options, remove_options, option_groups, formula }) =>
      runTool(async () => {
        assertWrite();
        const { properties } = await databases.getDatabase(userId, database_id);
        const prop = requireProperty(properties, property);
        const patch: { name?: string; options?: SelectOption[]; formula?: { expression: string } } = {};
        if (name !== undefined && name.trim() !== prop.name) {
          const needle = name.trim().toLowerCase();
          if (needle === "title" || properties.some((p) => p.id !== prop.id && p.name.trim().toLowerCase() === needle)) {
            throw new ToolInputError(`A property named "${name}" already exists in this database.`);
          }
          patch.name = name.trim();
        }
        if (add_options?.length || rename_options?.length || remove_options?.length || option_groups?.length) {
          if (!holdsOptions(prop.type)) {
            throw new ToolInputError(`"${prop.name}" is a ${prop.type} property; only select, multi_select and status have options.`);
          }
          if (option_groups?.length && prop.type !== "status") {
            throw new ToolInputError(`"${prop.name}" is a ${prop.type} property; only status options belong to groups.`);
          }
          patch.options = editOptions(prop, prop.options.options ?? [], {
            add: add_options ?? [],
            rename: rename_options ?? [],
            remove: remove_options ?? [],
            groups: option_groups,
          });
        }
        if (formula !== undefined) {
          if (prop.type !== "formula") throw new ToolInputError(`"${prop.name}" is a ${prop.type} property; only formulas have an expression.`);
          patch.formula = { expression: formula };
        }
        if (!patch.name && !patch.options && !patch.formula) {
          throw new ToolInputError("Nothing to change: provide name, option changes or formula.");
        }
        await databases.updateProperty(userId, prop.id, patch);
        const after = withFormulaTypes(
          properties.map((p) =>
            p.id !== prop.id
              ? p
              : {
                  ...p,
                  name: patch.name ?? p.name,
                  options: {
                    ...p.options,
                    ...(patch.options ? { options: patch.options } : {}),
                    ...(patch.formula ? { formula: { expression: formulaForStorage(patch.formula.expression, properties) } } : {}),
                  },
                },
          ),
        );
        const updated = after.find((p) => p.id === prop.id)!;
        return { database_id, property: describeProperty(updated, await databases.getLookups(userId, [updated]), after) };
      }),
  );

  server.registerTool(
    "delete_database_property",
    {
      title: "Delete a database property",
      description:
        "Delete a property (column) from a database. Its values are removed from every row and page history cannot bring them back, so confirm with the user first.",
      inputSchema: z.object({
        database_id: id("database"),
        property: z.string().min(1).describe("Property name or id."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      scopeChallenge: requireWrite,
    },
    ({ database_id, property }) =>
      runTool(async () => {
        assertWrite();
        const { properties } = await databases.getDatabase(userId, database_id);
        const prop = requireProperty(properties, property);
        await databases.deleteProperty(userId, prop.id);
        return { database_id, deleted: { id: prop.id, name: prop.name, type: prop.type } };
      }),
  );

  server.registerTool(
    "create_database_view",
    {
      title: "Create a database view",
      description:
        'Add a saved view to a database: a "table" (optionally grouped into collapsible sections with group_by), a "board" (cards in columns by group_by) or a "calendar" (rows placed on the days of a date property). Views group by a select, status (per option, or per todo / in_progress / done with group_status_by "group"), multi_select, person, created_by, last_edited_by, checkbox (unchecked / checked), date, created_time or last_edited_time (per day, week from Monday, month or year with group_date_by, month by default) or relation (one group per linked row); a row with several tags, people or links shows in each of their groups. Filters (with groups and filter_combinator) and sorts use the same form as query_database; a person filter on "me" shows everyone who opens the view their own rows, and is_within date filters count from the day the view is opened.',
      inputSchema: z.object({
        database_id: id("database"),
        name: z.string().min(1).max(100).describe("View name."),
        type: z.enum(["table", "board", "calendar"]).default("table"),
        group_by: z
          .string()
          .optional()
          .describe(
            "Board or table: the property to group rows by. Boards default to the first select or status property; tables are not grouped unless given.",
          ),
        ...groupSettingsInput,
        date_by: z.string().optional().describe("Calendar only: the date property that places rows on days. Defaults to the first date property."),
        filters: filtersInput.optional(),
        filter_combinator: filterCombinatorInput,
        sorts: sortsInput.optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      scopeChallenge: requireWrite,
    },
    ({ database_id, name, type, group_by, group_date_by, group_status_by, hide_empty_groups, date_by, filters, filter_combinator, sorts }) =>
      runTool(async () => {
        assertWrite();
        const { database, properties } = await databases.getDatabase(userId, database_id);
        if (database.archivedAt) throw new ToolInputError("This database is in the trash.");
        const lookups = await databases.getLookups(userId, properties);
        // Validate before creating so a bad filter does not leave a half-configured view behind.
        const patch = viewConfigPatch(
          properties,
          type,
          { group_by, group_date_by, group_status_by, hide_empty_groups, date_by, filters, filter_combinator, sorts },
          lookups,
        );
        const created = await databases.addView(userId, database_id, { name, type });
        const config = { ...created.config, ...patch };
        if (Object.keys(patch).length) await databases.updateView(userId, created.id, { config });
        return viewOutput(database, properties, { ...created, config }, lookups);
      }),
  );

  server.registerTool(
    "update_database_view",
    {
      title: "Update a database view",
      description:
        "Rename a saved view or change its filters, sorts, grouping (boards and tables, see create_database_view) or calendar date property (view ids from get_database). filters and sorts replace the view's current ones (filters with filter_combinator, \"and\" unless given); pass an empty array to clear them. filter_combinator alone switches how the current filters combine. Settings you leave out keep their values.",
      inputSchema: z.object({
        database_id: id("database"),
        view_id: id("view"),
        name: z.string().min(1).max(100).optional().describe("New view name."),
        group_by: z
          .string()
          .nullable()
          .optional()
          .describe("Board or table: the property to group rows by; null removes a table's grouping."),
        ...groupSettingsInput,
        date_by: z.string().optional().describe("Calendar only: the date property that places rows on days."),
        filters: filtersInput.optional(),
        filter_combinator: filterCombinatorInput,
        sorts: sortsInput.optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      scopeChallenge: requireWrite,
    },
    ({
      database_id,
      view_id,
      name,
      group_by,
      group_date_by,
      group_status_by,
      hide_empty_groups,
      date_by,
      filters,
      filter_combinator,
      sorts,
    }) =>
      runTool(async () => {
        assertWrite();
        const { database, properties, views } = await databases.getDatabase(userId, database_id);
        const view = views.find((v) => v.id === view_id);
        if (!view) throw new ToolInputError(`No view with id "${view_id}" in this database. Call get_database for view ids.`);
        const lookups = await databases.getLookups(userId, properties);
        const patch = viewConfigPatch(
          properties,
          view.type,
          { group_by, group_date_by, group_status_by, hide_empty_groups, date_by, filters, filter_combinator, sorts },
          lookups,
        );
        if (name === undefined && !Object.keys(patch).length) {
          throw new ToolInputError(
            "Nothing to change: provide name, group_by, group_date_by, group_status_by, hide_empty_groups, date_by, filters, filter_combinator or sorts.",
          );
        }
        const config = { ...view.config, ...patch };
        await databases.updateView(userId, view_id, {
          ...(name !== undefined ? { name } : {}),
          ...(Object.keys(patch).length ? { config } : {}),
        });
        return viewOutput(database, properties, { ...view, name: name?.trim() || view.name, config }, lookups);
      }),
  );

  server.registerTool(
    "move_page",
    {
      title: "Move a page",
      description:
        "Move a page (with its sub-pages) under another page, or to the top level of its workspace with parent_id null. Moving a page into a database makes it a row; moving a row out of its database turns it into a regular page. Pages cannot move between workspaces.",
      inputSchema: z.object({
        page_id: id("page"),
        parent_id: z.string().min(1).nullable().describe("New parent page id, or null for the workspace's top level."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      scopeChallenge: requireWrite,
    },
    ({ page_id, parent_id }) =>
      runTool(async () => {
        assertWrite();
        const { page, parentDatabase } = await loadPage(page_id);
        if (page.archivedAt) throw new ToolInputError("This page is in the trash. Restore it with restore_page first.");
        const parent = parent_id ? await pages.getPage(userId, parent_id) : null;
        if (parent) {
          if (parent.archivedAt) throw new ToolInputError("The new parent is in the trash. Choose another parent.");
          if (parent.workspaceId !== page.workspaceId) throw new ToolInputError("Pages cannot be moved to another workspace.");
          if (parent.kind === "database" && page.kind === "database") {
            throw new ToolInputError("A database cannot be moved into another database.");
          }
          const ancestors = await pages.getBreadcrumbs(userId, parent.id);
          if (ancestors.some((a) => a.id === page.id)) {
            throw new ToolInputError("A page cannot be moved inside itself or one of its sub-pages.");
          }
        }
        if ((parent?.id ?? null) !== page.parentId) await pages.movePage(userId, page_id, parent?.id ?? null);
        const note =
          parent?.kind === "database" && parentDatabase?.id !== parent.id
            ? "The page is now a row of this database; set its properties with update_database_row."
            : parentDatabase && parent?.id !== parentDatabase.id
              ? "The page is no longer a database row."
              : undefined;
        return {
          id: page.id,
          title: pageLabel(page.title),
          parent_id: parent?.id ?? null,
          ...(note ? { note } : {}),
          url: pageUrl(page.workspaceId, page.id),
        };
      }),
  );

  server.registerTool(
    "list_recent_pages",
    {
      title: "List recently edited pages",
      description: "List the most recently edited pages of a workspace (including database rows), newest first. Trashed pages are excluded.",
      inputSchema: z.object({
        workspace_id: id("workspace"),
        limit: z.number().int().min(1).max(50).default(10).describe("Maximum results (1-50, default 10)."),
      }),
      annotations: READ,
    },
    ({ workspace_id, limit }) =>
      runTool(async () => {
        const recent = await pages.recentPages(userId, workspace_id, limit);
        return {
          pages: recent.map((p) => ({
            id: p.id,
            title: pageLabel(p.title),
            kind: p.kind,
            icon: p.icon,
            updated_at: p.updatedAt.toISOString(),
            url: pageUrl(workspace_id, p.id),
          })),
        };
      }),
  );

  server.registerTool(
    "list_users",
    {
      title: "List workspace members",
      description: "List the people in a workspace with their name, email and role (owner, member or guest). Guests can't list them.",
      inputSchema: z.object({ workspace_id: id("workspace") }),
      annotations: READ,
    },
    ({ workspace_id }) =>
      runTool(async () => {
        const members = await workspaces.listMembers(userId, workspace_id);
        return {
          users: members.map((m) => ({ id: m.userId, name: m.name, email: m.email, role: m.role, is_you: m.userId === userId })),
        };
      }),
  );

  server.registerTool(
    "list_trash",
    {
      title: "List trashed pages",
      description:
        "List the pages in a workspace's trash, most recently trashed first. Only the top page of each trashed tree is listed; restoring it brings its sub-pages back too.",
      inputSchema: z.object({ workspace_id: id("workspace") }),
      annotations: READ,
    },
    ({ workspace_id }) =>
      runTool(async () => {
        const trashed = await pages.listTrash(userId, workspace_id);
        return {
          pages: trashed.map((p) => ({
            id: p.id,
            title: pageLabel(p.title),
            kind: p.kind,
            icon: p.icon,
            trashed_at: new Date(p.archived_at).toISOString(),
          })),
        };
      }),
  );

  server.registerTool(
    "restore_page",
    {
      title: "Restore a page from the trash",
      description:
        "Bring a trashed page back with its sub-pages (ids from list_trash). If its old parent is still in the trash, it is restored to the workspace's top level.",
      inputSchema: z.object({ page_id: id("page") }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      scopeChallenge: requireWrite,
    },
    ({ page_id }) =>
      runTool(async () => {
        assertWrite();
        const before = await pages.getPage(userId, page_id);
        if (before.archivedAt) await pages.restorePage(userId, page_id);
        const after = before.archivedAt ? await pages.getPage(userId, page_id) : before;
        return {
          id: after.id,
          title: pageLabel(after.title),
          parent_id: after.parentId,
          in_trash: false,
          ...(before.archivedAt
            ? after.parentId !== before.parentId
              ? { note: "Its old parent is still in the trash, so it was restored to the top level." }
              : {}
            : { note: "The page was not in the trash." }),
          url: pageUrl(after.workspaceId, after.id),
        };
      }),
  );

  server.registerTool(
    "list_page_history",
    {
      title: "List a page's history",
      description:
        "List saved versions of a page's body, newest first, with who made the change (a user, or a user through an MCP client). Read one with get_page_version and bring it back with restore_page_version.",
      inputSchema: z.object({ page_id: id("page") }),
      annotations: READ,
    },
    ({ page_id }) =>
      runTool(async () => {
        const snapshots = await pages.listSnapshots(userId, page_id);
        return {
          page_id,
          versions: snapshots.map((s) => ({
            id: s.id,
            title: pageLabel(s.title),
            saved_at: new Date(s.createdAt).toISOString(),
            reason: s.reason,
            by: s.clientName ? `${s.authorName ?? "Unknown"} via ${s.clientName}` : (s.authorName ?? null),
          })),
        };
      }),
  );

  server.registerTool(
    "get_page_version",
    {
      title: "Read a saved page version",
      description: `Read the title and Markdown body of a saved version from list_page_history. Long bodies are cut at ${MAX_MARKDOWN_CHARS} characters; pass offset to continue reading.`,
      inputSchema: z.object({
        version_id: id("version"),
        offset: z.number().int().min(0).default(0).describe("Character offset into the Markdown body."),
      }),
      annotations: READ,
    },
    ({ version_id, offset }) =>
      runTool(async () => {
        const snap = await pages.getSnapshot(userId, version_id);
        const body = sliceText(snap.contentMarkdown, offset);
        return {
          id: snap.id,
          page_id: snap.pageId,
          title: pageLabel(snap.title),
          saved_at: new Date(snap.createdAt).toISOString(),
          markdown: body.text,
          ...(body.truncated
            ? { markdown_truncated: true, markdown_total_chars: body.totalChars, ...("note" in body ? { note: body.note } : {}) }
            : {}),
        };
      }),
  );

  server.registerTool(
    "restore_page_version",
    {
      title: "Restore a saved page version",
      description:
        "Replace a page's title and body with a saved version from list_page_history. The current version is saved to history first, so this can be undone the same way.",
      inputSchema: z.object({ version_id: id("version") }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      scopeChallenge: requireWrite,
    },
    ({ version_id }) =>
      runTool(async () => {
        assertWrite();
        const snap = await pages.getSnapshot(userId, version_id);
        const page = await pages.getPage(userId, snap.pageId);
        if (page.archivedAt) throw new ToolInputError("This page is in the trash. Restore it with restore_page first.");
        await pages.restoreSnapshot(actor, version_id);
        return {
          id: page.id,
          title: pageLabel(snap.title),
          restored_version: snap.id,
          snapshot: "Saved the previous version to page history before restoring.",
          url: pageUrl(page.workspaceId, page.id),
        };
      }),
  );

  return server;
}
