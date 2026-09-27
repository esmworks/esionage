import { Readable } from "node:stream";
import { McpServer, type ScopeChallengeHandler } from "@modelcontextprotocol/server";
import * as z from "zod";
import {
  PROPERTY_TYPES,
  type CardSize,
  type ChartSort,
  type ChartType,
  type FilterCombinator,
  type RollupConfig,
  type SelectOption,
  type StatusGroup,
  type TimelineZoom,
  type ViewConfig,
  type ViewCover,
  type ViewType,
} from "@/db/schema/app";
import { AGGREGATE_FNS, ROLLUP_DISPLAYS, type AggregateFn } from "@/lib/aggregate";
import { commentText, MAX_COMMENT_LENGTH } from "@/lib/comments";
import { markdownReferences } from "@/lib/embed-blocks";
import { FILTER_COMBINATORS, MAX_FILTER_DEPTH, MAX_RELATIVE_DAYS, RELATIVE_DATE_RANGES } from "@/lib/filters";
import {
  canStack,
  CHART_AGGREGATE_FNS,
  CHART_SORTS,
  CHART_TYPES,
  chartAggregateFunctionsOf,
  chartGroupProperty,
  chartMeasure,
  chartTypeOf,
  isStackable,
} from "@/lib/chart";
import { formulaForStorage, withFormulaTypes } from "@/lib/derived";
import { MAX_FORMULA_LENGTH } from "@/lib/formula";
import {
  FORM_TITLE,
  canDefault,
  isAskable,
  MAX_CONFIRMATION,
  MAX_FORM_DEFAULTS,
  MAX_FORM_DESCRIPTION,
  MAX_FORM_QUESTIONS,
  MAX_FORM_TITLE,
  MAX_QUESTION_DESCRIPTION,
  MAX_QUESTION_LABEL,
} from "@/lib/forms";
import { GROUP_DATE_BY } from "@/lib/grouping";
import { pageLabel } from "@/lib/labels";
import { diffToText, wordsToText } from "@/lib/page-diff";
import { isGroupable, sortStatusOptions, statusColor } from "@/lib/properties";
import { holdsOptions, holdsTimestamp, STATUS_GROUPS } from "@/lib/property-types";
import { CARD_SIZES, TIMELINE_ZOOMS, VIEW_TYPES } from "@/lib/views";
import { getCollab, type WriteActor } from "@/server/collab/bridge";
import * as comments from "@/server/comments";
import * as databases from "@/server/databases";
import * as files from "@/server/files";
import { uploadLimits } from "@/server/storage";
import { asFiles, blockTypeFor, formatBytes } from "@/lib/files";
import { resolveEmbeds } from "@/server/embeds";
import * as forms from "@/server/forms";
import { labelPageLinks, listBacklinks } from "@/server/mentions";
import * as notifications from "@/server/notifications";
import * as pages from "@/server/pages";
import * as templates from "@/server/templates";
import { builtinTemplates, isBuiltinTemplateKey } from "@/lib/builtin-templates";
import * as teamspaces from "@/server/teamspaces";
import * as workspaces from "@/server/workspaces";
import { MAX_MARKDOWN_CHARS, pageUrl, runTool, sliceText, ToolInputError } from "./format";
import { env } from "@/lib/env";
import { CONNECT_SCOPES, FILES_SCOPE, NOTIFICATIONS_SCOPE, WRITE_SCOPE, type McpPrincipal } from "./principal";
import {
  describeProperty,
  describeChartSeries,
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
Pages form a tree inside a workspace. A database is a special page whose children are rows; rows are pages with typed properties (text, number, select, multi_select, status, date, checkbox, url, email, phone, checklist, files, relation, person, created_by, created_time, last_edited_by, last_edited_time, formula, rollup). A relation links rows to rows of another database in the same workspace; two-way relations show the links on both databases. A person property assigns rows to people of the workspace; "me" stands for the signed-in user. A status is a select whose options belong to the groups todo, in_progress and done. A checklist holds items that can be ticked off. A files property holds files uploaded to the workspace (images show as thumbnails); its values read as [{name, url}]. created_by, created_time, last_edited_by and last_edited_time show who created or last edited each row and when; they are filled in automatically and can't be written. A formula property computes its value from the row's other properties, and a rollup calculates over the rows a relation links to (see add_database_property); neither can be written.
Start with list_workspaces or search to find ids, then get_page / list_pages / query_database.
Teamspaces group a workspace's pages and people (list_teamspaces). A teamspace is default (everyone is in it), open (anyone can join; others can read), closed (only its members open its pages) or private (only its members know it). A top-level page belongs to a teamspace, or is private to the user who made it; pages under it follow it. create_page, create_database and move_page take a teamspace_id for top-level pages ("private" for the user's private pages); without one, new top-level pages are private.
Page bodies are read and written as Markdown. Before every content change Esionage saves a history snapshot, so the user can undo your edits from the page history (list_page_history / diff_page_version / restore_page_version).
Beyond plain Markdown, page bodies know a few block forms: a callout is a GitHub alert (\`> [!NOTE]\`, TIP, IMPORTANT, WARNING or CAUTION on its own line, then the \`> \` text; a leading emoji becomes its icon), \`$…$\` is an inline equation and a \`$$\` line pair wraps a block equation (LaTeX), a \`\`\`mermaid fence is a diagram, and the lines \`<!-- esionage:toc -->\` and \`<!-- esionage:breadcrumb -->\` are a table of contents and the page's breadcrumb. A web bookmark (a link card) reads as a link on a line of its own, \`[Title](url)\`, and stays a bookmark when you write the body back; to add a new one write \`[Title](url) <!-- esionage:bookmark -->\`. An embed (YouTube, Vimeo, Loom, Figma, published Google Docs/Sheets/Slides, CodePen, Spotify, Google Maps) is \`[url](url) <!-- esionage:embed -->\`. A dollar sign of the text itself is written \`\\$\`.
Mentions: a link to a page of this app (\`[Roadmap](/w/<workspace_id>/p/<page_id>)\`) is a page mention, which shows the page's live title (the link text you write is ignored; get_page shows the current title, or "No access" / "Deleted page"); that link alone on its line followed by \`<!-- esionage:page-link -->\` is a "Link to page" block. \`@Name\` with a person's name as list_users shows it mentions them (they are notified if they can open the page), and \`@YYYY-MM-DD\` is a date. Keep mentions as they are when you rewrite a page: people aren't notified twice and reminders set on dates stay. get_page lists the pages linking to a page under linked_from.
People discuss pages in comment threads anchored to text of the page: list_comments reads them, add_comment starts a thread on quoted text or replies to one.
list_notifications shows the user's inbox: rows someone assigned them to, pages shared with them, new comments in their threads, mentions of them and reminders they set on dates.
attach_file adds an image, video, audio or other file to a page, from a URL or base64 data, or (with property) to a row's files property. Files in page bodies show up in the Markdown with paths like /api/files/<id>.
Templates are starting points for new pages and rows: list_templates lists a workspace's page templates (and the built-in gallery) or a database's row templates; create_page and create_database_row take a template_id. A database's default row template is used by create_database_row when no properties or body are given. Templates don't show up in search or list_pages.
Always share the returned url with the user when you create or change something.`;

const MAX_BULK_ROWS = 100;

const EMBED_NOTE =
  "Databases shown inside a page body appear in its Markdown as their own lines, `<!-- esionage:database <id> -->` (an inline database) or `<!-- esionage:linked-view <id> -->` (a linked view of a database); get_page lists them under embedded_databases.";

const id = (what: string) => z.string().min(1).describe(`The ${what} id (a UUID from another tool's output).`);

const checklistItem = z.object({ text: z.string(), checked: z.boolean().optional() });
const fileItem = z.object({ url: z.string(), name: z.string().optional() });
const rowValue = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), checklistItem, fileItem])),
  z.null(),
]);
const rowProperties = z
  .record(z.string(), rowValue)
  .describe(
    'Property values keyed by property name (case-insensitive) or id. Use option names for select / multi_select / status (an array for multi_select), ISO dates (YYYY-MM-DD) for date, true/false for checkbox, an email address for email, a phone number for phone, an array of item texts or {text, checked} objects for checklist, an array of row ids (or exact row titles) of the related database for relation, an array of user ids, emails, names or "me" for person, an array of files already uploaded to this workspace (their /api/files/<id> paths or urls, or the {name, url} objects query_database returns; upload new ones with attach_file and its property option) for files, and null to clear a value. Setting a relation, person, checklist or files replaces its values. created_by, created_time, last_edited_by, last_edited_time and formula properties are read-only. Example: {"Status": "In progress", "Tags": ["urgent"], "Due": "2026-10-01", "Customer": ["Acme Ltd"], "Assignee": ["me"]}',
  );

/** How formulas are written, for tool descriptions. */
const FORMULA_HELP =
  'Reference properties with prop("Name") (prop("title") is the row title). Operators: + - * / % ^, == != < <= > >=, and or not; "+" also joins text. Functions: if, ifs, empty, and, or, not; concat, length, lower, upper, trim, contains, startsWith, endsWith, replace, replaceAll, slice, join, format; round, floor, ceil, abs, sqrt, sign, pow, min, max; toNumber, parseDate; now, today, dateAdd, dateSubtract, dateBetween (units: years, quarters, months, weeks, days, hours, minutes, seconds), formatDate (tokens YYYY MM DD HH mm…), year, month, day, weekday, hour, minute, timestamp. Select and status read as their option name; multi-select, relation, person and files (their names) as lists; checklists as the share of ticked items; dates work in UTC. Invalid formulas are refused with the reason. Formula values are read-only; query_database returns them and can filter and sort on them like values of their result type.';
const formulaInput = z.string().max(MAX_FORMULA_LENGTH);

/** How rollups are set up, for tool descriptions. */
const ROLLUP_HELP =
  'A rollup calculates over the rows a relation links to: pass rollup {relation, property, function}, naming a relation property of this database and a property of the related database ("title" for the related rows\' titles). Functions: show_original (lists the values), count_all, count_values, count_unique, count_empty, count_not_empty, percent_empty, percent_not_empty; for numbers sum, average, median, min, max, range; for dates earliest_date, latest_date, date_range (days); for checkboxes count_checked, count_unchecked, percent_checked, percent_unchecked. display (number, bar or ring) is how the app shows a percentage. Only related rows the reader can see count. Percentages come back as fractions (0.25) and filter as percent points (25).';
const rollupInput = z.object({
  relation: z.string().min(1).describe("Relation property of this database, by name or id."),
  property: z.string().min(1).describe('Property of the related database, by name or id, or "title".'),
  function: z.enum(["show_original", ...AGGREGATE_FNS]),
  display: z.enum(ROLLUP_DISPLAYS).optional(),
});

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

/** The relation a rollup reads through, for loading what describes it. */
function rollupRelations<P extends PropertyDef>(prop: P, props: P[]): P[] {
  const id = prop.type === "rollup" ? prop.options.rollup?.relationPropertyId : undefined;
  return props.filter((p) => p.id === id && p.type === "relation");
}

/** Rollup settings given by names, as property ids (databases.addProperty checks the rest). */
async function rollupSettings(
  userId: string,
  props: databases.DatabaseProperty[],
  input: { relation: string; property: string; function: string; display?: string },
): Promise<databases.RollupInput> {
  const relation = requireProperty(props, input.relation);
  if (relation.type !== "relation") throw new ToolInputError(`"${relation.name}" is a ${relation.type} property, not a relation.`);
  const target = (await databases.getRelationTargets(userId, [relation]))[relation.id];
  if (!target?.database) throw new ToolInputError(`The database "${relation.name}" links to can't be read.`);
  const { key, prop } = resolvePropertyKey(target.properties, input.property);
  if (!prop && key !== "title") throw new ToolInputError(`Rollups read a property of the related database or "title", not "${input.property}".`);
  return {
    relationPropertyId: relation.id,
    targetPropertyId: prop ? prop.id : "title",
    function: input.function,
    ...(input.display ? { display: input.display } : {}),
  };
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

/** Layout settings of gallery and timeline views, shared by create_database_view and update_database_view. */
const viewLayoutInputs = {
  end_date_by: z
    .string()
    .nullable()
    .optional()
    .describe("Timeline only: the date property where bars end (null for none). Without it every bar is one day long."),
  zoom: z.enum(TIMELINE_ZOOMS).optional().describe('Timeline only: a column per day, week or month ("week" by default).'),
  show_table: z.boolean().optional().describe("Timeline only: show row titles in a table left of the bars (true by default)."),
  card_size: z.enum(CARD_SIZES).optional().describe('Gallery only: card size ("medium" by default).'),
  cover: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Gallery only: "first_image" shows the first image in each row\'s body on its card (the default), "none" no cover, or the name of a files property to show the first image it holds.',
    ),
  chart_type: z
    .enum(CHART_TYPES)
    .optional()
    .describe('Chart only: "bar" (vertical columns, the default), "horizontal_bar", "line" or "donut" (a pie chart with a hole).'),
  aggregate: z
    .enum(["count", ...CHART_AGGREGATE_FNS])
    .optional()
    .describe(
      'Chart only: what each group measures. "count" (the default) counts rows; the others calculate over aggregate_property: sum, average, median, min, max, range for numbers; count_values, count_unique, count_empty, count_not_empty, percent_empty, percent_not_empty for any property; date_range (in days) for dates; count_checked, count_unchecked, percent_checked, percent_unchecked for checkboxes.',
    ),
  aggregate_property: z
    .string()
    .optional()
    .describe("Chart only: the property the aggregate calculates over (needed for every aggregate but count). Formula and rollup properties calculate like their result type: a number formula can be summed."),
  stack_by: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Bar and horizontal_bar charts only: split each bar into segments by a second property holding one value per row (select, status, checkbox, date, created or edited time, created by, last edited by; null for none). Only for measures that add up: count, sum, count_values, count_empty, count_not_empty, count_checked, count_unchecked.",
    ),
  chart_sort: z
    .enum(CHART_SORTS)
    .optional()
    .describe('Chart only: "group" keeps the grouping\'s order (options in option order, dates oldest first; the default), "value_desc" / "value_asc" order by value.'),
  show_values: z.boolean().optional().describe("Chart only: print each value on its bar or point, and in a donut's legend (false by default)."),
  show_legend: z.boolean().optional().describe("Donut charts only: show the legend (true by default)."),
};

type ViewInput = {
  group_by?: string | null;
  group_date_by?: (typeof GROUP_DATE_BY)[number];
  group_status_by?: "option" | "group";
  hide_empty_groups?: boolean;
  date_by?: string;
  end_date_by?: string | null;
  zoom?: TimelineZoom;
  show_table?: boolean;
  card_size?: CardSize;
  /** "first_image", "none" or a files property's name. */
  cover?: string;
  chart_type?: ChartType;
  aggregate?: "count" | AggregateFn;
  aggregate_property?: string;
  stack_by?: string | null;
  chart_sort?: ChartSort;
  show_values?: boolean;
  show_legend?: boolean;
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
function viewConfigPatch(
  props: PropertyDef[],
  type: ViewType,
  input: ViewInput,
  lookups: Lookups,
  current: ViewConfig = {},
): ViewConfig {
  const patch: ViewConfig = {};
  const only = (setting: string, ...types: ViewType[]) => {
    if (types.includes(type)) return;
    const names = types.length > 1 ? `${types.slice(0, -1).join(", ")} and ${types.at(-1)}` : types[0];
    throw new ToolInputError(`${setting} only applies to ${names} views.`);
  };
  const grouped = type === "board" || type === "table" || type === "chart";
  if (input.group_by !== undefined) {
    only("group_by", "board", "table", "timeline", "chart");
    if (input.group_by === null) {
      if (type === "board") throw new ToolInputError("Boards always group their cards; pass a property to group by.");
      if (type === "chart") throw new ToolInputError("Charts always group their rows; pass a property to group by.");
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
    throw new ToolInputError("group_date_by, group_status_by and hide_empty_groups only apply to board, table and chart views.");
  }
  if (input.group_date_by) patch.groupDateBy = input.group_date_by;
  if (input.group_status_by) patch.groupStatusBy = input.group_status_by === "group" ? "group" : undefined;
  if (input.hide_empty_groups !== undefined) patch.hideEmptyGroups = input.hide_empty_groups || undefined;
  if (input.date_by !== undefined) {
    only("date_by", "calendar", "timeline");
    const prop = requireProperty(props, input.date_by);
    if (type === "calendar" && prop.type !== "date") {
      throw new ToolInputError(`Calendars place rows by a date property; "${prop.name}" is ${prop.type}.`);
    }
    if (type === "timeline" && prop.type !== "date" && !holdsTimestamp(prop.type)) {
      throw new ToolInputError(
        `Timelines start bars at a date, created_time or last_edited_time property; "${prop.name}" is ${prop.type}.`,
      );
    }
    patch.dateBy = prop.id;
  }
  if (input.end_date_by !== undefined) {
    only("end_date_by", "timeline");
    if (input.end_date_by === null) patch.endDateBy = undefined;
    else {
      const prop = requireProperty(props, input.end_date_by);
      if (prop.type !== "date") throw new ToolInputError(`Timeline bars end at a date property; "${prop.name}" is ${prop.type}.`);
      patch.endDateBy = prop.id;
    }
  }
  if (input.zoom !== undefined) {
    only("zoom", "timeline");
    patch.zoom = input.zoom;
  }
  if (input.show_table !== undefined) {
    only("show_table", "timeline");
    patch.showTable = input.show_table;
  }
  if (input.card_size !== undefined) {
    only("card_size", "gallery");
    patch.cardSize = input.card_size;
  }
  if (input.cover !== undefined) {
    only("cover", "gallery");
    patch.cover = toCover(props, input.cover);
  }
  if (type === "chart") Object.assign(patch, chartConfigPatch(props, input, { ...current, ...patch }));
  else {
    for (const setting of ["chart_type", "aggregate", "aggregate_property", "stack_by", "chart_sort", "show_values", "show_legend"] as const) {
      if (input[setting] !== undefined) only(setting, "chart");
    }
  }
  if (input.filters) patch.filters = toFilterEntries(props, input.filters, lookups);
  // New filters replace the old ones together with how they combine ("and" unless given).
  if (input.filters || input.filter_combinator) {
    patch.filterCombinator = input.filter_combinator === "or" ? "or" : undefined;
  }
  if (input.sorts) patch.sorts = input.sorts.map((s) => toSortRule(props, s));
  return patch;
}

/** A gallery cover from tool input: "first_image", "none", or a files property (by name or id). */
function toCover(props: PropertyDef[], cover: string): ViewCover {
  if (cover === "first_image" || cover === "none") return { source: cover };
  const prop = props.find((p) => p.id === cover) ?? props.find((p) => p.name.toLowerCase() === cover.toLowerCase());
  if (!prop) {
    throw new ToolInputError(`Cover must be "first_image", "none" or the name of a files property; there is no property "${cover}".`);
  }
  if (prop.type !== "files") throw new ToolInputError(`Covers come from a files property; "${prop.name}" is ${prop.type}.`);
  return { source: "property", propertyId: prop.id };
}

/** A chart's settings from tool input; `current` is the saved config the patch will be merged into. */
function chartConfigPatch(props: PropertyDef[], input: ViewInput, current: ViewConfig): ViewConfig {
  const patch: ViewConfig = {};
  if (input.chart_type !== undefined) patch.chartType = input.chart_type;
  if (input.chart_sort !== undefined) patch.chartSort = input.chart_sort === "group" ? undefined : input.chart_sort;
  if (input.show_values !== undefined) patch.showValues = input.show_values || undefined;
  if (input.show_legend !== undefined) patch.showLegend = input.show_legend ? undefined : false;
  if (input.aggregate === "count") {
    if (input.aggregate_property !== undefined) throw new ToolInputError('aggregate_property doesn\'t apply to "count", which counts rows.');
    patch.chartAggregate = undefined;
  } else if (input.aggregate !== undefined || input.aggregate_property !== undefined) {
    // Either may change alone: the other one comes from the saved calculation.
    const fn = input.aggregate ?? current.chartAggregate?.fn;
    const ref = input.aggregate_property ?? props.find((p) => p.id === current.chartAggregate?.propertyId)?.id;
    if (!fn) throw new ToolInputError("aggregate_property needs an aggregate to calculate, such as sum or average.");
    if (!ref) throw new ToolInputError(`aggregate "${fn}" needs aggregate_property: the property to calculate over.`);
    const prop = requireProperty(props, ref);
    const offered = chartAggregateFunctionsOf(prop);
    if (!offered.includes(fn)) {
      throw new ToolInputError(
        `Charts can't calculate ${fn} over "${prop.name}" (${prop.type}); it offers count, ${offered.join(", ")}.`,
      );
    }
    patch.chartAggregate = { fn, propertyId: prop.id };
  }
  if (input.stack_by !== undefined) {
    if (input.stack_by === null) patch.stackBy = undefined;
    else {
      const prop = requireProperty(props, input.stack_by);
      if (!isStackable(prop.type)) {
        throw new ToolInputError(
          `Charts stack by a property holding one value per row (select, status, checkbox, date, created or edited time, created by, last edited by); "${prop.name}" is ${prop.type}.`,
        );
      }
      patch.stackBy = prop.id;
    }
  }
  // A new stack property must work with the settings as they'll be saved: bars, a measure that adds
  // up, and another property than the groups. A saved one merely rests while it doesn't (like in the app).
  const next = { ...current, ...patch };
  const stackBy = input.stack_by && props.find((p) => p.id === next.stackBy);
  if (stackBy) {
    const chartType = chartTypeOf(next);
    if (!canStack(chartType, chartMeasure(next, props))) {
      throw new ToolInputError(
        `stack_by only applies to bar and horizontal_bar charts measuring count, sum, count_values, count_empty, count_not_empty, count_checked or count_unchecked.`,
      );
    }
    if (chartGroupProperty(props, next)?.id === stackBy.id) {
      throw new ToolInputError(`A chart can't stack by "${stackBy.name}", the property it groups by.`);
    }
  }
  return patch;
}

/** Form settings, shared by create_database_view and update_database_view. */
const formInputs = {
  questions: z
    .array(
      z.object({
        property: z.string().min(1).describe('Property name or id, or "title" for the row\'s name.'),
        required: z.boolean().optional().describe("The form can't be sent without an answer (for a checkbox: a tick)."),
        label: z.string().max(MAX_QUESTION_LABEL).optional().describe("Question text shown instead of the property name."),
        description: z.string().max(MAX_QUESTION_DESCRIPTION).optional().describe("Help text under the question."),
      }),
    )
    .max(MAX_FORM_QUESTIONS)
    .optional()
    .describe(
      'Form only: the questions, in order; replaces the current ones. A new form asks for the title (required) and every property a form can ask for. created_by, created_time, last_edited_by, last_edited_time, formula and rollup properties can\'t be asked; relation and person questions are asked in the app only, never on the public link.',
    ),
  form_title: z.string().max(MAX_FORM_TITLE).optional().describe("Form only: heading of the form (the database title when empty)."),
  form_description: z.string().max(MAX_FORM_DESCRIPTION).optional().describe("Form only: text under the heading."),
  confirmation_message: z
    .string()
    .max(MAX_CONFIRMATION)
    .optional()
    .describe("Form only: shown after an answer is sent (a generic thank-you when empty)."),
  allow_another: z.boolean().optional().describe("Form only: offer to send another answer after one is sent (true by default)."),
  defaults: z
    .record(z.string(), rowValue)
    .optional()
    .describe(
      'Form only: values every row sent through the form gets for properties it doesn\'t ask, keyed by property name or id, in the same form as row values; replaces the current ones. Example: {"Status": "New"}.',
    ),
  public: z
    .boolean()
    .optional()
    .describe(
      "Form only: true opens the form to anyone with the link (needs full access to the database and a workspace that lets the user publish); false turns the link off. Turning it on again makes a new link.",
    ),
  anonymous: z
    .boolean()
    .optional()
    .describe(
      "Form with a public link: true takes answers without signing in and records nobody as creator; false (the default) asks people to sign in and records them.",
    ),
};

type FormInput = {
  questions?: { property: string; required?: boolean; label?: string; description?: string }[];
  form_title?: string;
  form_description?: string;
  confirmation_message?: string;
  allow_another?: boolean;
  defaults?: Record<string, unknown>;
  public?: boolean;
  anonymous?: boolean;
};

const FORM_SETTINGS = [
  "questions",
  "form_title",
  "form_description",
  "confirmation_message",
  "allow_another",
  "defaults",
  "public",
  "anonymous",
] as const;

/** The form settings the caller asked to change, merged into the view's form. Names become ids. */
function formConfigPatch(props: PropertyDef[], type: ViewType, current: ViewConfig, input: FormInput): ViewConfig {
  const given = FORM_SETTINGS.filter((key) => input[key] !== undefined);
  if (!given.length) return {};
  if (type !== "form") throw new ToolInputError(`${given.join(", ")} only apply to form views.`);
  const form = { ...current.form };
  if (input.questions) {
    const seen = new Set<string>();
    form.questions = input.questions.map((q) => {
      const { key, prop } = resolvePropertyKey(props, q.property);
      if (!prop && key !== FORM_TITLE) throw new ToolInputError(`"${q.property}" can't be asked in a form.`);
      if (prop && !isAskable(prop.type)) throw new ToolInputError(`"${prop.name}" is ${prop.type}, which a form can't ask for.`);
      if (seen.has(key)) throw new ToolInputError(`"${q.property}" is asked twice.`);
      seen.add(key);
      return {
        propertyId: key,
        ...(q.required ? { required: true } : {}),
        ...(q.label?.trim() ? { label: q.label.trim() } : {}),
        ...(q.description?.trim() ? { description: q.description.trim() } : {}),
      };
    });
  }
  if (input.form_title !== undefined) form.title = input.form_title.trim() || undefined;
  if (input.form_description !== undefined) form.description = input.form_description.trim() || undefined;
  if (input.confirmation_message !== undefined) form.confirmation = input.confirmation_message.trim() || undefined;
  if (input.allow_another !== undefined) form.allowAnother = input.allow_another ? undefined : false;
  if (input.defaults) {
    const asked = new Set((form.questions ?? []).map((q) => q.propertyId));
    const entries = Object.entries(input.defaults);
    if (entries.length > MAX_FORM_DEFAULTS) throw new ToolInputError(`A form can set at most ${MAX_FORM_DEFAULTS} default values.`);
    // Values stay as given (option names, emails, "me"…): updateView checks and stores them as ids.
    form.defaults = Object.fromEntries(
      entries.map(([ref, value]) => {
        const prop = requireProperty(props, ref);
        if (!canDefault(prop.type)) throw new ToolInputError(`"${prop.name}" is ${prop.type}; it can't have a default value.`);
        if (asked.has(prop.id)) throw new ToolInputError(`"${prop.name}" is a question; its answer is what the row gets.`);
        return [prop.id, value];
      }),
    );
  }
  return { form };
}

/** Opens or closes a form's public link as asked; returns the link, if any. */
async function applyFormLink(userId: string, viewId: string, input: FormInput) {
  try {
    if (input.public === false) {
      if (input.anonymous !== undefined) throw new ToolInputError("anonymous only applies while the form has a public link.");
      await forms.unpublishForm(userId, viewId);
    } else if (input.public || input.anonymous !== undefined) {
      const current = (await forms.formPublicationsOf([viewId])).get(viewId);
      if (!input.public && !current) throw new ToolInputError("anonymous only applies while the form has a public link; pass public: true.");
      await forms.publishForm(userId, viewId, { anonymous: input.anonymous ?? current?.anonymous ?? false });
    }
  } catch (error) {
    if (error instanceof forms.FormError) throw new ToolInputError(`${error.message}.`);
    throw error;
  }
  return (await forms.formPublicationsOf([viewId])).get(viewId) ?? null;
}

/** How a form view is shared, for tool output. */
function formLinkOutput(type: ViewType, link: { url: string; anonymous: boolean } | null | undefined) {
  if (type !== "form") return {};
  return link ? { public_url: `${env.appUrl}${link.url}`, anonymous: link.anonymous } : { public_url: null };
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
    ...describeViewConfig(props, view.config, lookups, view.type),
    url: pageUrl(database.workspaceId, database.id),
  };
}

/**
 * Write tools advertise a step-up challenge so clients can re-authorize with pages:write. It asks
 * for the full connect set, so one reconnect also brings offline_access and the token refreshes
 * instead of falling back to a fresh read-only authorization.
 */
const requireWrite: ScopeChallengeHandler = ({ authInfo }) => {
  if (!authInfo || authInfo.scopes.includes(WRITE_SCOPE)) return undefined;
  const scopes = [...new Set([...authInfo.scopes, ...CONNECT_SCOPES])] as [string, ...string[]];
  return { scopes, errorDescription: "This tool needs the pages:write scope" };
};

/** The inbox tool advertises a step-up challenge for notifications:read the same way. */
const requireNotifications: ScopeChallengeHandler = ({ authInfo }) => {
  if (!authInfo || authInfo.scopes.includes(NOTIFICATIONS_SCOPE)) return undefined;
  const scopes = [...new Set([...authInfo.scopes, ...CONNECT_SCOPES])] as [string, ...string[]];
  return { scopes, errorDescription: "This tool needs the notifications:read scope" };
};

/** attach_file needs files:write on top of pages:write, and challenges for both the same way. */
const requireFiles: ScopeChallengeHandler = ({ authInfo }) => {
  if (!authInfo || (authInfo.scopes.includes(FILES_SCOPE) && authInfo.scopes.includes(WRITE_SCOPE))) return undefined;
  const scopes = [...new Set([...authInfo.scopes, ...CONNECT_SCOPES])] as [string, ...string[]];
  return { scopes, errorDescription: "This tool needs the files:write and pages:write scopes" };
};

/** `data:<type>;base64,<data>` or bare base64 (standard or URL-safe alphabet, whitespace allowed). */
function decodeBase64(input: string): { bytes: Buffer; contentType: string | null } {
  const dataUrl = /^data:([^;,]*)(?:;[^,]*)?;base64,/i.exec(input);
  const data = (dataUrl ? input.slice(dataUrl[0].length) : input).replace(/\s+/g, "");
  if (!data || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(data)) throw new ToolInputError("base64 isn't valid base64 data.");
  return { bytes: Buffer.from(data, "base64"), contentType: dataUrl?.[1] || null };
}

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
        env.appUrl,
      ),
      url: pageUrl(database.workspaceId, row.id),
    };
  };

  /**
   * Where a new page goes: under `parentId`, or at the top of `workspaceId`, in the teamspace
   * `teamspaceId` names (see spaceOf; private when missing).
   */
  const resolveLocation = async (workspaceId?: string, parentId?: string, teamspaceId?: string) => {
    if (parentId) {
      const parent = await pages.getPage(userId, parentId);
      if (parent.archivedAt) throw new ToolInputError("The parent page is in the trash. Choose another parent.");
      return { workspaceId: parent.workspaceId, parentId, parentKind: parent.kind, teamspaceId: undefined };
    }
    const space = spaceOf(teamspaceId);
    if (!workspaceId && space) {
      const teamspace = await teamspaces.getTeamspace(userId, space).catch(() => null);
      if (!teamspace) throw new ToolInputError("Unknown teamspace_id. Call list_teamspaces for the ids.");
      workspaceId = teamspace.workspaceId;
    }
    if (!workspaceId) {
      throw new ToolInputError("Provide workspace_id (to create at the top level) or parent_id (to nest under a page).");
    }
    return { workspaceId, parentId: null, parentKind: null, teamspaceId: space ?? null };
  };

  /** A teamspace_id argument: an id, or "private" (null) for the user's private pages. */
  const spaceOf = (value?: string | null) => (value === undefined || value === null ? undefined : value === "private" ? null : value);

  /** The teamspace a page is in, as tools show it: its id and name, or null for a private page. */
  const teamspaceOf = async (teamspaceId: string | null) => {
    if (!teamspaceId) return { teamspace_id: null, teamspace: "Private" };
    const label = await teamspaces.teamspaceLabel(userId, teamspaceId);
    return { teamspace_id: teamspaceId, teamspace: label?.name ?? null };
  };

  server.registerTool(
    "list_workspaces",
    {
      title: "List workspaces",
      description:
        "List the workspaces the user belongs to, with their ids. Use a workspace id with list_teamspaces, list_pages, search or create_page.",
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
    "list_teamspaces",
    {
      title: "List teamspaces",
      description:
        'List the teamspaces of a workspace the user can see: all but private ones they aren\'t in. access is "default" (everyone is in it), "open" (anyone can join; others can read and comment), "closed" (only its members open its pages) or "private" (only its members know it). Pass an id as teamspace_id to create_page, create_database, move_page or list_pages; can_add_pages says whether the user may add top-level pages to it.',
      inputSchema: z.object({
        workspace_id: id("workspace"),
        include_archived: z.boolean().default(false).describe("Also list archived teamspaces."),
      }),
      annotations: READ,
    },
    ({ workspace_id, include_archived }) =>
      runTool(async () => {
        const list = await teamspaces.listTeamspaces(userId, workspace_id, { archived: include_archived ? "all" : "active" });
        return {
          teamspaces: list.map((t) => ({
            id: t.id,
            name: t.name,
            icon: t.icon,
            description: t.description || undefined,
            access: t.access,
            archived: Boolean(t.archivedAt),
            member_count: t.memberCount,
            owners: t.owners.map((o) => o.name),
            joined: t.joined,
            role: t.role,
            can_add_pages: t.joined && !t.archivedAt,
          })),
          note: 'Pages outside every teamspace are private: create_page / move_page with teamspace_id "private".',
        };
      }),
  );

  server.registerTool(
    "list_notifications",
    {
      title: "List notifications",
      description:
        "List the user's inbox, newest first: database rows someone assigned them to, pages someone shared with them and new comments in comment threads the user is in, with who did it and a link. Only the kinds the user keeps in their inbox are listed. Reading does not mark them read.",
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
                  : n.kind === "comment"
                    ? `${who} commented on "${title}" in a thread the user is in (see list_comments)`
                    : n.kind === "mention"
                      ? `${who} mentioned the user on "${title}"`
                      : n.kind === "reminder"
                        ? `Reminder the user set for ${n.reminderDate ?? "a date"} on "${title}"`
                        : `${who} shared "${title}" with the user`,
              actor: n.actorName,
              page_id: n.pageId,
              title,
              ...(n.kind === "assignment" ? { database: pageLabel(n.databaseTitle), property: n.propertyName } : {}),
              ...(n.kind === "reminder" ? { date: n.reminderDate } : {}),
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
            teamspace_id: h.teamspaceId,
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
        "List the pages directly under a parent page, or the top-level pages of a workspace when parent_id is omitted (of every teamspace the user can read, their private pages and pages shared with them; teamspace_id narrows it to one). Trashed pages are excluded. For database rows prefer query_database.",
      inputSchema: z.object({
        workspace_id: id("workspace"),
        parent_id: z.string().optional().describe("Parent page id. Omit for the workspace's top-level pages."),
        teamspace_id: z
          .string()
          .optional()
          .describe('Top level only: just this teamspace\'s pages (from list_teamspaces), or "private" for the user\'s private pages.'),
      }),
      annotations: READ,
    },
    ({ workspace_id, parent_id, teamspace_id }) =>
      runTool(async () => {
        const children = await pages.listChildren(userId, workspace_id, parent_id ?? null, { teamspaceId: spaceOf(teamspace_id) });
        return {
          pages: children.map((c) => ({
            id: c.id,
            title: pageLabel(c.title),
            kind: c.kind,
            icon: c.icon,
            teamspace_id: c.teamspaceId,
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
      description: `Read a page: title, breadcrumb path, Markdown body, sub-pages and a link. For database rows it also returns the row's properties; for databases it returns the schema summary (use query_database for rows). Long bodies are cut at ${MAX_MARKDOWN_CHARS} characters; pass offset to continue reading. ${EMBED_NOTE}`,
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
        // Mentioned pages read as their current title, as far as the user can see them.
        const body = sliceText(await labelPageLinks(userId, content.markdown), offset);
        const out: Record<string, unknown> = {
          id: page.id,
          title: pageLabel(content.title || page.title),
          kind: page.kind,
          icon: page.icon,
          workspace_id: page.workspaceId,
          ...(await teamspaceOf(page.teamspaceId)),
          // A parent they can't see stays unnamed, id included.
          parent_id: parent?.id ?? null,
          path: [workspace?.name ?? "Workspace", ...crumbs.map((c) => pageLabel(c.title))].join(" / "),
          in_trash: Boolean(page.archivedAt),
          updated_at: page.updatedAt.toISOString(),
          url: pageUrl(page.workspaceId, page.id),
        };
        if (page.isTemplate) out.template = parentDatabase ? "row_template" : "page_template";
        else if (page.inTemplate) out.template = "inside_template";
        if (parentDatabase) {
          const { properties } = await databases.getDatabase(userId, parentDatabase.id);
          out.database_id = parentDatabase.id;
          out.properties = displayProperties(
            properties,
            await databases.rowValues(userId, page, properties),
            await databases.getLookups(userId, properties),
            env.appUrl,
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
          const embeds = await resolveEmbeds(userId, markdownReferences(content.markdown));
          if (embeds.length) {
            out.embedded_databases = embeds.map((e) => ({
              database_id: e.databaseId,
              kind: e.type === "database" ? "inline_database" : "linked_view",
              // Seeing the page doesn't mean seeing the database: its title stays private then.
              title: e.database ? pageLabel(e.database.title) : null,
              accessible: Boolean(e.database),
              in_trash: e.database?.inTrash ?? false,
              url: e.database ? pageUrl(e.database.workspaceId, e.database.id) : null,
            }));
          }
          const children = await pages.listChildren(userId, page.workspaceId, page.id);
          out.child_pages = children.slice(0, 100).map((c) => ({ id: c.id, title: pageLabel(c.title), kind: c.kind }));
          if (children.length > 100) out.child_pages_truncated = children.length;
          const backlinks = await listBacklinks(userId, page.id);
          if (backlinks.length) {
            out.linked_from = backlinks.map((b) => ({ id: b.id, title: pageLabel(b.title), url: pageUrl(b.workspaceId, b.id) }));
          }
        }
        return out;
      }),
  );

  server.registerTool(
    "list_templates",
    {
      title: "List templates",
      description:
        'List templates to start new pages from: the page templates of a workspace plus the built-in gallery (ids "builtin:<key>"), or, with database_id, the row templates of that database and which one is the default. Pass an id as template_id to create_page or create_database_row. Templates are pages: read or edit one with get_page / update_page.',
      inputSchema: z.object({
        workspace_id: z.string().optional().describe("Workspace whose page templates to list. Ignored when database_id is set."),
        database_id: z.string().optional().describe("Database whose row templates to list."),
      }),
      annotations: READ,
    },
    ({ workspace_id, database_id }) =>
      runTool(async () => {
        if (database_id) {
          const { database } = await databases.getDatabase(userId, database_id);
          const rows = await templates.listRowTemplates(userId, database_id);
          return {
            database_id,
            default_template_id: rows.defaultTemplateId,
            templates: rows.templates.map((t) => ({
              id: t.id,
              title: pageLabel(t.title),
              default: t.id === rows.defaultTemplateId,
              url: pageUrl(database.workspaceId, t.id),
            })),
          };
        }
        if (!workspace_id) throw new ToolInputError("Provide workspace_id (page templates) or database_id (row templates).");
        const list = await templates.listTemplates(userId, workspace_id);
        return {
          templates: list.map((t) => ({
            id: t.id,
            title: pageLabel(t.title),
            kind: t.kind,
            url: pageUrl(workspace_id, t.id),
          })),
          built_in: builtinTemplates("en").map((t) => ({ id: `builtin:${t.key}`, title: t.title, kind: t.kind, description: t.description })),
        };
      }),
  );

  server.registerTool(
    "create_page",
    {
      title: "Create a page",
      description:
        "Create a new page at the top level of a workspace (workspace_id, in a teamspace given by teamspace_id, else private to the user) or nested under another page (parent_id; it then belongs to the parent's teamspace), with an optional Markdown body, or copy a template (template_id from list_templates) with its sub-pages. To add a row to a database use create_database_row instead.",
      inputSchema: z.object({
        workspace_id: z.string().optional().describe("Workspace for a top-level page. Ignored when parent_id is set."),
        parent_id: z.string().optional().describe("Page to nest the new page under."),
        teamspace_id: z
          .string()
          .optional()
          .describe(
            'Top-level pages: the teamspace to add it to (from list_teamspaces; the user must be in it), or "private" (the default) for a page only the user sees. Ignored when parent_id is set.',
          ),
        title: z.string().min(1).max(500).optional().describe("Page title. Required unless template_id is given (the template's title is used then)."),
        markdown: z.string().optional().describe("Initial page body in Markdown. With template_id it replaces the template's body."),
        icon: z.string().max(16).optional().describe("A single emoji used as the page icon."),
        template_id: z
          .string()
          .optional()
          .describe('A page template of the workspace, or a built-in one ("builtin:<key>"), from list_templates.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      scopeChallenge: requireWrite,
    },
    ({ workspace_id, parent_id, teamspace_id, title, markdown, icon, template_id }) =>
      runTool(async () => {
        assertWrite();
        const location = await resolveLocation(workspace_id, parent_id, teamspace_id);
        if (location.parentKind === "database") {
          throw new ToolInputError("parent_id is a database. Use create_database_row to add rows to it.");
        }
        if (template_id) {
          let createdId: string;
          if (template_id.startsWith("builtin:")) {
            const key = template_id.slice("builtin:".length);
            if (!isBuiltinTemplateKey(key)) throw new ToolInputError(`Unknown built-in template "${key}". Call list_templates for the keys.`);
            createdId = (
              await templates.createFromBuiltin(actor, location.workspaceId, key, {
                parentId: location.parentId,
                teamspaceId: location.teamspaceId,
              })
            ).id;
          } else {
            const template = await pages.getPage(userId, template_id);
            if (!template.isTemplate || template.parentId) {
              throw new ToolInputError("template_id is not a page template. Call list_templates; row templates go to create_database_row.");
            }
            createdId = (
              await templates.createFromTemplate(actor, template_id, { parentId: location.parentId, teamspaceId: location.teamspaceId })
            ).id;
          }
          if (title !== undefined) await pages.renamePage(actor, createdId, title);
          if (icon !== undefined) await pages.setPageIcon(userId, createdId, icon);
          if (markdown !== undefined) await getCollab().replaceContent(createdId, markdown, actor);
          const created = await pages.getPage(userId, createdId);
          return {
            id: created.id,
            title: pageLabel(created.title),
            workspace_id: created.workspaceId,
            ...(await teamspaceOf(created.teamspaceId)),
            parent_id: created.parentId,
            from_template: template_id,
            url: pageUrl(created.workspaceId, created.id),
          };
        }
        if (title === undefined) throw new ToolInputError("Provide title (or template_id).");
        const created = await pages.createPage(actor, {
          workspaceId: location.workspaceId,
          parentId: location.parentId,
          teamspaceId: location.teamspaceId,
          title,
          icon: icon ?? null,
          markdown,
        });
        return {
          id: created.id,
          title: pageLabel(created.title),
          workspace_id: created.workspaceId,
          ...(await teamspaceOf(created.teamspaceId)),
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
        `Change a page's title and/or body. mode "replace" overwrites the whole body with the given Markdown; mode "append" adds it to the end. A history snapshot is saved before the body changes, and open editors update live. Works for database rows too (use update_database_row for their properties). ${EMBED_NOTE} Keep those lines where the databases should stay; a linked view whose line is left out is removed, while an inline database whose line is left out stays at the end of the page.`,
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

  const maxFile = uploadLimits().maxFileBytes;
  server.registerTool(
    "attach_file",
    {
      title: "Attach a file to a page",
      description: `Upload a file (image, video, audio, PDF or any other file) to a page, either from a public http(s) URL, which Esionage downloads, or from base64 data. By default it is added to the end of the page body as an image, video, audio or file block, chosen by its type; a history snapshot is saved first. With append false it is only stored: put the returned path into the body yourself (e.g. \`![caption](/api/files/…)\` with update_page) within a day, or the unused upload is removed. With property (a files property of the row the page is), the file is added to that property's value instead of the body. Files can be at most ${formatBytes(maxFile)}, and URLs must point at a public address. Only people who can see the page can open the file.`,
      inputSchema: z.object({
        page_id: id("page"),
        url: z.string().max(4000).optional().describe("A public http(s) URL to download the file from. Give url or base64."),
        base64: z
          .string()
          .max(Math.ceil(maxFile / 3) * 4 + 1024)
          .optional()
          .describe("The file's bytes as base64 (a data: URL works too). Give url or base64."),
        name: z.string().max(200).optional().describe("File name, with its extension. Taken from the URL when missing; needed for base64."),
        content_type: z.string().max(255).optional().describe("Media type, e.g. image/png. Guessed from the name or the server when missing."),
        caption: z.string().max(1000).optional().describe("Caption shown under the block."),
        append: z.boolean().default(true).describe("Add the file to the end of the page body (default true). Ignored with property."),
        property: z
          .string()
          .optional()
          .describe("A files property (name or id) of the database row page_id is: the file is added to its value, not the body."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      scopeChallenge: requireFiles,
    },
    ({ page_id, url, base64, name, content_type, caption, append, property }) =>
      runTool(async () => {
        assertWrite();
        if (!principal.scopes.includes(FILES_SCOPE)) {
          throw new ToolInputError(
            "This connection can't upload files: the user did not grant the files:write permission. Ask the user to reconnect Esionage and allow it.",
          );
        }
        if ((url === undefined) === (base64 === undefined)) throw new ToolInputError("Give either url or base64, not both.");
        const { page, parentDatabase } = await loadPage(page_id);
        if (page.archivedAt) throw new ToolInputError("This page is in the trash. Restore it in Esionage before adding files.");
        if (page.kind === "database") throw new ToolInputError("Databases have no body. Attach the file to one of its rows.");
        let filesProp: PropertyDef | null = null;
        if (property !== undefined) {
          if (!parentDatabase) throw new ToolInputError("property only applies to database rows; this page is not one.");
          const { properties } = await databases.getDatabase(userId, parentDatabase.id);
          const prop = requireProperty(properties, property);
          if (prop.type !== "files") throw new ToolInputError(`"${prop.name}" is a ${prop.type} property, not a files property.`);
          filesProp = prop;
        }
        let stored: files.StoredFile;
        try {
          if (url !== undefined) {
            stored = await files.uploadFromUrl(userId, page_id, url, { name, contentType: content_type });
          } else {
            if (!name) throw new ToolInputError("Give the file a name (with its extension) when sending base64.");
            const decoded = decodeBase64(base64!);
            stored = await files.uploadFile(userId, page_id, {
              name,
              contentType: content_type ?? decoded.contentType,
              body: Readable.from([decoded.bytes]),
              declaredSize: decoded.bytes.length,
            });
          }
        } catch (error) {
          if (error instanceof files.FileError) throw new ToolInputError(`${error.message}.`);
          throw error;
        }
        if (filesProp) {
          const current = asFiles(page.properties?.[filesProp.id]);
          await databases.updateRowProperties(userId, page_id, { [filesProp.id]: [...current, { url: stored.url }] });
          return {
            id: stored.id,
            name: stored.name,
            content_type: stored.contentType,
            size: stored.size,
            path: stored.url,
            url: `${env.appUrl}${stored.url}`,
            property: filesProp.name,
            row: await rowOutput(parentDatabase!.id, page_id),
          };
        }
        const type = blockTypeFor(stored.contentType);
        if (append) {
          await getCollab().appendBlocks(
            page_id,
            [{ type, props: { url: stored.url, name: stored.name, caption: caption ?? "" } }],
            actor,
            true,
          );
        }
        return {
          id: stored.id,
          name: stored.name,
          content_type: stored.contentType,
          size: stored.size,
          block: type,
          path: stored.url,
          url: `${env.appUrl}${stored.url}`,
          appended: append,
          ...(append
            ? { snapshot: "Saved the previous version to page history before adding the file." }
            : { markdown: type === "image" ? `![${caption ?? stored.name}](${stored.url})` : `[${stored.name}](${stored.url})` }),
          page_url: pageUrl(page.workspaceId, page.id),
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
        "Get a database's schema: its properties (name, type, option names for select / multi_select / status with the status groups, and the people a person property can hold), its views with their type, settings (grouping, dates, timeline zoom, gallery cards, form questions and public link), filters and sorts, and the row count. Call this before querying or writing rows.",
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
        const links = await forms.formPublicationsOf(views.filter((v) => v.type === "form").map((v) => v.id));
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
          views: views.map((v) => ({
            id: v.id,
            name: v.name,
            type: v.type,
            ...describeViewConfig(properties, v.config, lookups, v.type),
            ...formLinkOutput(v.type, links.get(v.id)),
          })),
          url: pageUrl(database.workspaceId, database.id),
        };
      }),
  );

  server.registerTool(
    "query_database",
    {
      title: "Query database rows",
      description:
        'List rows of a database with optional filters and sorts. Filters reference properties by name (or "title", "created_at", "updated_at") and use select / status option names as values; by default all filters must match, filter_combinator "or" lets any match, and groups ({type: "group", combinator, rules}) mix the two, e.g. Status is Done and (Assignee contains me or Priority is High). Ops: contains, equals, not_equals, is_empty, is_not_empty, gt, lt, is_within. For a relation use contains / not_equals with a related row id or title; for a person, created_by or last_edited_by, contains / not_equals with a user id, email, name or "me". For dates, created_time and last_edited_time, equals (that day), gt (after) and lt (before) take a YYYY-MM-DD date, and is_within takes today, this_week (Monday to Sunday), this_month, or past_n_days / next_n_days with "days" (both include today), counted from the current date on the server. Checklists and files only support is_empty / is_not_empty. Sorting by a person orders rows by name, a status by its groups, a checklist by the share of ticked items, files by how many there are. Returns property values by name; relations as [{id, title}], people as [{id, name}], checklists as [{text, checked}], files as [{name, url}].',
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
            properties: displayProperties(props, r.properties, lookups, env.appUrl),
            url: pageUrl(database.workspaceId, r.id),
          })),
          ...(rows.length > limit ? { note: `Only the first ${limit} rows are shown; narrow the filters or raise limit.` } : {}),
          // A chart view also returns what it plots, over every matching row (not just the returned ones).
          ...(view?.type === "chart"
            ? {
                chart: {
                  ...describeViewConfig(props, { ...view.config, filters: undefined, sorts: undefined }, lookups, "chart"),
                  ...describeChartSeries(props, view.config, rows, lookups),
                },
              }
            : {}),
        };
      }),
  );

  server.registerTool(
    "create_database_row",
    {
      title: "Add a database row",
      description:
        "Add a row to a database with a title, property values (by property name, select options by name) and an optional Markdown body. Call get_database first to learn the property names and options. Without properties and markdown the row starts from the database's default row template, if it has one; template_id picks a row template (see list_templates), with the given properties set over its values.",
      inputSchema: z.object({
        database_id: id("database"),
        title: z.string().min(1).max(500).describe("Row title."),
        properties: rowProperties.optional(),
        markdown: z.string().optional().describe("Optional Markdown body for the row's page. With a template it replaces the template's body."),
        template_id: z
          .string()
          .optional()
          .describe('A row template of this database from list_templates, or "none" for a blank row even when the database has a default template.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      scopeChallenge: requireWrite,
    },
    ({ database_id, title, properties, markdown, template_id }) =>
      runTool(async () => {
        assertWrite();
        const { database } = await databases.getDatabase(userId, database_id);
        if (database.archivedAt) throw new ToolInputError("This database is in the trash.");
        const blank = template_id === "none";
        const noValues = !Object.keys(properties ?? {}).length && markdown === undefined;
        if (!blank && (template_id || noValues)) {
          const created = await templates.createRow(actor, database.id, {
            title,
            properties: properties ?? {},
            templateId: template_id ?? null,
            useDefault: noValues,
          });
          if (markdown !== undefined) await getCollab().replaceContent(created.id, markdown, actor);
          const output = await rowOutput(database.id, created.id);
          return created.templateId ? { ...output, from_template: created.templateId } : output;
        }
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
        'Create a new database (a table of rows) at the top level of a workspace (in a teamspace given by teamspace_id, else private to the user) or under a page. It starts with a "Status" status property (Not started, In progress, Done) and a "Tags" multi-select; add more with add_database_property.',
      inputSchema: z.object({
        workspace_id: z.string().optional().describe("Workspace for a top-level database. Ignored when parent_id is set."),
        parent_id: z.string().optional().describe("Page to create the database under."),
        teamspace_id: z
          .string()
          .optional()
          .describe('Top level: the teamspace (from list_teamspaces), or "private" (the default). Ignored when parent_id is set.'),
        title: z.string().min(1).max(500).describe("Database title."),
        icon: z.string().max(16).optional().describe("A single emoji used as the icon."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      scopeChallenge: requireWrite,
    },
    ({ workspace_id, parent_id, teamspace_id, title, icon }) =>
      runTool(async () => {
        assertWrite();
        const location = await resolveLocation(workspace_id, parent_id, teamspace_id);
        if (location.parentKind === "database") throw new ToolInputError("A database cannot be created inside another database.");
        const created = await pages.createPage(actor, {
          workspaceId: location.workspaceId,
          parentId: location.parentId,
          teamspaceId: location.teamspaceId,
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
        `Add a property (column) to a database. For select and multi_select, pass the option names. For status, pass option names (spread over the groups: the first is todo, the last done, the ones between in_progress) or {name, group} objects; without options a status gets Not started, In progress and Done. Other types ignore options. For a relation, pass related_database_id (a database in the same workspace, or this one); with two_way the related database also gets a property listing the links back. created_by, created_time, last_edited_by and last_edited_time properties fill themselves in with who created or last edited each row and when. A formula computes its value from the row's other properties: pass the expression in formula. ${FORMULA_HELP} ${ROLLUP_HELP}`,
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
        rollup: rollupInput.optional().describe("Rollup only: what to calculate over which relation."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      scopeChallenge: requireWrite,
    },
    ({ database_id, name, type, options, related_database_id, two_way, paired_property_name, formula, rollup }) =>
      runTool(async () => {
        assertWrite();
        if (type === "relation" && !related_database_id) throw new ToolInputError("A relation needs related_database_id.");
        if (type !== "relation" && (related_database_id || paired_property_name)) {
          throw new ToolInputError("related_database_id and paired_property_name only apply to relation properties.");
        }
        if (type === "formula" && !formula?.trim()) throw new ToolInputError("A formula property needs formula, its expression.");
        if (type !== "formula" && formula !== undefined) throw new ToolInputError("formula only applies to formula properties.");
        if (type === "rollup" && !rollup) throw new ToolInputError("A rollup property needs rollup: {relation, property, function}.");
        if (type !== "rollup" && rollup !== undefined) throw new ToolInputError("rollup only applies to rollup properties.");
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
          ...(type === "rollup" ? { rollup: await rollupSettings(userId, properties, rollup!) } : {}),
        });
        // Formulas come with their result type.
        const after = withFormulaTypes([...properties, created]);
        const shown = after[after.length - 1];
        const lookups = await databases.getLookups(userId, [shown, ...rollupRelations(shown, after)]);
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
        rollup: rollupInput
          .partial()
          .optional()
          .describe(`Rollup only: the settings to change (the others stay). ${ROLLUP_HELP}`),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      scopeChallenge: requireWrite,
    },
    ({ database_id, property, name, add_options, rename_options, remove_options, option_groups, formula, rollup }) =>
      runTool(async () => {
        assertWrite();
        const { properties } = await databases.getDatabase(userId, database_id);
        const prop = requireProperty(properties, property);
        const patch: {
          name?: string;
          options?: SelectOption[];
          formula?: { expression: string };
          rollup?: Partial<databases.RollupInput>;
        } = {};
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
        if (rollup !== undefined) {
          if (prop.type !== "rollup") throw new ToolInputError(`"${prop.name}" is a ${prop.type} property; only rollups have rollup settings.`);
          const current = prop.options.rollup;
          const relationRef = rollup.relation ?? current?.relationPropertyId;
          const propertyRef = rollup.property ?? (rollup.relation ? undefined : current?.targetPropertyId);
          if (!relationRef || !propertyRef) {
            throw new ToolInputError("A rollup moved to another relation needs property too: a property of that relation's database.");
          }
          patch.rollup = await rollupSettings(userId, properties, {
            relation: relationRef,
            property: propertyRef,
            function: rollup.function ?? current?.function ?? "show_original",
            display: rollup.display ?? current?.display,
          });
        }
        if (!patch.name && !patch.options && !patch.formula && !patch.rollup) {
          throw new ToolInputError("Nothing to change: provide name, option changes, formula or rollup.");
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
                    ...(patch.rollup ? { rollup: patch.rollup as RollupConfig } : {}),
                  },
                },
          ),
        );
        const updated = after.find((p) => p.id === prop.id)!;
        const lookups = await databases.getLookups(userId, [updated, ...rollupRelations(updated, after)]);
        return { database_id, property: describeProperty(updated, lookups, after) };
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
        'Add a saved view to a database: a "table" (optionally grouped into collapsible sections with group_by), a "board" (cards in columns by group_by), a "calendar" (rows placed on the days of a date property), a "gallery" (cards with a cover: the first image in each row\'s body, or in a files property with cover), a "list" (one compact line per row), a "timeline" (bars from a start date to an optional end date, optionally in swimlanes by group_by) or a "form" (questions people answer to add a row; see questions, defaults and public). Views group by a select, status (per option, or per todo / in_progress / done with group_status_by "group"), multi_select, person, created_by, last_edited_by, checkbox (unchecked / checked), date, created_time or last_edited_time (per day, week from Monday, month or year with group_date_by, month by default) or relation (one group per linked row); a row with several tags, people or links shows in each of their groups. Filters (with groups and filter_combinator) and sorts use the same form as query_database; a person filter on "me" shows everyone who opens the view their own rows, and is_within date filters count from the day the view is opened.',
      inputSchema: z.object({
        database_id: id("database"),
        name: z.string().min(1).max(100).describe("View name."),
        type: z.enum(VIEW_TYPES).default("table"),
        group_by: z
          .string()
          .optional()
          .describe(
            "Board, table or timeline: the property to group rows by. Boards default to the first select or status property; tables are not grouped and timelines have no swimlanes unless given.",
          ),
        ...groupSettingsInput,
        date_by: z
          .string()
          .optional()
          .describe(
            "Calendar: the date property that places rows on days. Timeline: the date (or created_time / last_edited_time) property where bars start. Defaults to the first date property.",
          ),
        ...viewLayoutInputs,
        ...formInputs,
        filters: filtersInput.optional(),
        filter_combinator: filterCombinatorInput,
        sorts: sortsInput.optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      scopeChallenge: requireWrite,
    },
    ({ database_id, name, type, filters, filter_combinator, sorts, ...input }) =>
      runTool(async () => {
        assertWrite();
        const { database, properties } = await databases.getDatabase(userId, database_id);
        if (database.archivedAt) throw new ToolInputError("This database is in the trash.");
        const lookups = await databases.getLookups(userId, properties);
        const { questions, form_title, form_description, confirmation_message, allow_another, defaults, ...settings } = input;
        const formInput: FormInput = { questions, form_title, form_description, confirmation_message, allow_another, defaults };
        const { public: isPublic, anonymous, ...layout } = settings;
        const linkInput: FormInput = { public: isPublic, anonymous };
        // Validate before creating so a bad filter does not leave a half-configured view behind.
        const patch = viewConfigPatch(properties, type, { ...layout, filters, filter_combinator, sorts }, lookups);
        formConfigPatch(properties, type, {}, { ...formInput, ...linkInput });
        const created = await databases.addView(userId, database_id, { name, type });
        let config = { ...created.config, ...patch, ...formConfigPatch(properties, type, created.config, formInput) };
        if (Object.keys(patch).length || config.form !== created.config.form) {
          // Stored form defaults hold ids where the caller gave names.
          config = (await databases.updateView(userId, created.id, { config }))?.config ?? config;
        }
        const link = type === "form" ? await applyFormLink(userId, created.id, linkInput) : null;
        return { ...viewOutput(database, properties, { ...created, config }, lookups), ...formLinkOutput(type, link) };
      }),
  );

  server.registerTool(
    "update_database_view",
    {
      title: "Update a database view",
      description:
        "Rename a saved view or change its filters, sorts, grouping (boards and tables, see create_database_view) or timeline swimlanes, calendar or timeline dates, timeline zoom and table, gallery cards, or a form's questions, texts, default values and public link (view ids from get_database). filters and sorts replace the view's current ones (filters with filter_combinator, \"and\" unless given); pass an empty array to clear them. filter_combinator alone switches how the current filters combine. Settings you leave out keep their values.",
      inputSchema: z.object({
        database_id: id("database"),
        view_id: id("view"),
        name: z.string().min(1).max(100).optional().describe("New view name."),
        group_by: z
          .string()
          .nullable()
          .optional()
          .describe("Board, table or timeline: the property to group rows by; null removes a table's grouping or a timeline's swimlanes."),
        ...groupSettingsInput,
        date_by: z
          .string()
          .optional()
          .describe("Calendar: the date property that places rows on days. Timeline: the property where bars start."),
        ...viewLayoutInputs,
        ...formInputs,
        filters: filtersInput.optional(),
        filter_combinator: filterCombinatorInput,
        sorts: sortsInput.optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      scopeChallenge: requireWrite,
    },
    ({ database_id, view_id, name, filters, filter_combinator, sorts, ...input }) =>
      runTool(async () => {
        assertWrite();
        const { database, properties, views } = await databases.getDatabase(userId, database_id);
        const view = views.find((v) => v.id === view_id);
        if (!view) throw new ToolInputError(`No view with id "${view_id}" in this database. Call get_database for view ids.`);
        const lookups = await databases.getLookups(userId, properties);
        const { questions, form_title, form_description, confirmation_message, allow_another, defaults, ...settings } = input;
        const formInput: FormInput = { questions, form_title, form_description, confirmation_message, allow_another, defaults };
        const { public: isPublic, anonymous, ...layout } = settings;
        const linkInput: FormInput = { public: isPublic, anonymous };
        formConfigPatch(properties, view.type, view.config, linkInput);
        const patch = {
          ...viewConfigPatch(properties, view.type, { ...layout, filters, filter_combinator, sorts }, lookups, view.config),
          ...formConfigPatch(properties, view.type, view.config, formInput),
        };
        const linkChange = isPublic !== undefined || anonymous !== undefined;
        if (name === undefined && !Object.keys(patch).length && !linkChange) {
          throw new ToolInputError("Nothing to change: provide name, a view setting, filters, filter_combinator or sorts.");
        }
        let config = { ...view.config, ...patch };
        if (name !== undefined || Object.keys(patch).length) {
          const stored = await databases.updateView(userId, view_id, {
            ...(name !== undefined ? { name } : {}),
            ...(Object.keys(patch).length ? { config } : {}),
          });
          config = stored?.config ?? config;
        }
        const link =
          view.type !== "form"
            ? null
            : linkChange
              ? await applyFormLink(userId, view_id, linkInput)
              : ((await forms.formPublicationsOf([view_id])).get(view_id) ?? null);
        const saved = { ...view, name: name?.trim() || view.name, config };
        return { ...viewOutput(database, properties, saved, lookups), ...formLinkOutput(view.type, link) };
      }),
  );

  server.registerTool(
    "move_page",
    {
      title: "Move a page",
      description:
        "Move a page (with its sub-pages) under another page, or to the top level with parent_id null: of the teamspace teamspace_id names, of the user's private pages (\"private\"), or of the teamspace it is in now when teamspace_id is omitted. A page that lands in another teamspace (or among the private pages) takes the access of its new place; people it was shared with by name keep their access. Moving a page into a database makes it a row; moving a row out of its database turns it into a regular page. Pages cannot move between workspaces.",
      inputSchema: z.object({
        page_id: id("page"),
        parent_id: z.string().min(1).nullable().describe("New parent page id, or null for the top level."),
        teamspace_id: z
          .string()
          .optional()
          .describe('With parent_id null: the teamspace to move it to (from list_teamspaces), or "private". Ignored under a parent.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      scopeChallenge: requireWrite,
    },
    ({ page_id, parent_id, teamspace_id }) =>
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
        const space = parent ? undefined : spaceOf(teamspace_id);
        if ((parent?.id ?? null) !== page.parentId || (space !== undefined && space !== page.teamspaceId)) {
          await pages.movePage(userId, page_id, parent?.id ?? null, undefined, space);
        }
        const moved = await pages.getPage(userId, page_id).catch(() => null);
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
          ...(moved ? await teamspaceOf(moved.teamspaceId) : {}),
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
        "List saved versions of a page's body, newest first, with who made the change (a user, or a user through an MCP client). Read one with get_page_version, see what changed with diff_page_version and bring it back with restore_page_version.",
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
        const body = sliceText(await labelPageLinks(userId, snap.contentMarkdown), offset);
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
    "diff_page_version",
    {
      title: "Compare a saved page version",
      description:
        'Show what changed between a saved version from list_page_history and the current page (against "current"), or between the version saved before it and this one (against "previous"). One line per block: "+" added, "-" removed, "~" changed with [-removed-] and {+added+} words inside; unchanged stretches are folded. changed_by names who made the changes, as far as the history records it.',
      inputSchema: z.object({
        version_id: id("version"),
        against: z
          .enum(["current", "previous"])
          .default("current")
          .describe('"current": this version → the page now. "previous": the version before → this version.'),
        offset: z.number().int().min(0).default(0).describe("Character offset into the diff text."),
      }),
      annotations: READ,
    },
    ({ version_id, against, offset }) =>
      runTool(async () => {
        const { diffSnapshot } = await import("@/server/page-history");
        const diff = await diffSnapshot(userId, version_id, against);
        if (!diff) return { version_id, against, note: "This is the oldest saved version; there is nothing earlier to compare it with." };
        const changed = diff.title !== null || diff.changes.some((c) => c.op !== "same");
        const body = sliceText(changed ? diffToText(diff.changes) : "", offset);
        return {
          from: diff.fromId,
          to: diff.toId ?? "current",
          changed,
          ...(diff.title ? { title: wordsToText(diff.title) } : {}),
          changed_by: diff.actors.map((a) => (a.client ? `${a.name ?? "Unknown"} via ${a.client}` : a.name)),
          diff: body.text,
          ...(body.truncated
            ? { diff_truncated: true, diff_total_chars: body.totalChars, ...("note" in body ? { note: body.note } : {}) }
            : {}),
        };
      }),
  );

  server.registerTool(
    "list_comments",
    {
      title: "List comments on a page",
      description:
        "List a page's comment threads, oldest first: the text each thread is about (quote; null when that text was deleted), whether it's resolved, and its comments with author, time and text. Resolved threads are left out unless include_resolved is true.",
      inputSchema: z.object({
        page_id: id("page"),
        include_resolved: z.boolean().default(false).describe("Also list resolved threads."),
      }),
      annotations: READ,
    },
    ({ page_id, include_resolved }) =>
      runTool(async () => {
        const page = await pages.getPage(userId, page_id);
        const threads = (await comments.listComments(userId, page_id)).filter((t) => include_resolved || !t.resolved);
        const people = await comments.commentUsers(
          userId,
          page_id,
          threads.flatMap((t) => t.comments.map((c) => c.userId)),
        );
        const names = new Map(people.map((p) => [p.id, p.username]));
        return {
          page_id: page.id,
          title: pageLabel(page.title),
          threads: threads.map((t) => ({
            id: t.id,
            quote: t.quote ?? null,
            resolved: t.resolved,
            comments: t.comments.map((c) => ({
              id: c.id,
              author: names.get(c.userId) ?? "Unknown",
              author_id: c.userId,
              created_at: c.createdAt,
              ...(c.updatedAt !== c.createdAt ? { edited_at: c.updatedAt } : {}),
              text: commentText(c.body),
              ...(c.reactions.length ? { reactions: c.reactions.map((r) => ({ emoji: r.emoji, count: r.userIds.length })) } : {}),
            })),
          })),
          url: pageUrl(page.workspaceId, page.id),
        };
      }),
  );

  server.registerTool(
    "add_comment",
    {
      title: "Comment on a page",
      description:
        "Comment on a page as the user. To start a thread, pass quote: text copied exactly from the page body (get_page), within one paragraph; the comment is anchored to its first occurrence. To reply, pass thread_id from list_comments instead. People in the thread are notified. Comments are plain text; each line becomes a paragraph.",
      inputSchema: z.object({
        page_id: id("page"),
        text: z.string().min(1).max(MAX_COMMENT_LENGTH).describe("The comment."),
        quote: z.string().min(1).max(1000).optional().describe("Start a new thread on this exact text of the page."),
        thread_id: z.string().min(1).optional().describe("Reply in this thread instead."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      scopeChallenge: requireWrite,
    },
    ({ page_id, text, quote, thread_id }) =>
      runTool(async () => {
        assertWrite();
        if (!quote === !thread_id) throw new ToolInputError("Pass either quote (to start a thread) or thread_id (to reply), not both.");
        const page = await pages.getPage(userId, page_id);
        const result = thread_id
          ? await comments.changeComments(userId, page_id, { type: "addComment", threadId: thread_id, body: text })
          : await comments.changeComments(userId, page_id, { type: "createThread", body: text, anchor: { quote: quote! } }).catch((error) => {
              if (error instanceof Error && error.message.includes("quoted text")) {
                throw new ToolInputError(
                  "The page doesn't have that exact text within one paragraph. Copy a short passage from get_page's markdown, without formatting characters.",
                );
              }
              throw error;
            });
        return {
          thread_id: result.thread?.id,
          comment_id: result.comment?.id,
          url: pageUrl(page.workspaceId, page.id),
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
