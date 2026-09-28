import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  doublePrecision,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type { AiAutofillConfig } from "../../lib/ai";
import type { AggregateFn, RollupDisplay, RollupFn } from "../../lib/aggregate";
import type { FormulaResultType } from "../../lib/formula/types";
import { PROPERTY_TYPES, type PropertyType, type StatusGroup } from "../../lib/property-types";
import { user } from "./auth";

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => new Uint8Array(value),
});

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** Workspace-wide policies, changed by owners in Settings > Security. */
export type WorkspaceSettings = {
  /** Who may share pages with people outside the workspace, bringing them in as guests. */
  guestInvites: "owners" | "members";
  /** Whether guests may add top-level pages, which only they can see. */
  guestPrivatePages: boolean;
  /** Who may publish pages to the web. Guests never can. */
  publishing: "owners" | "members";
  /**
   * Everyone must use two-step verification (an authenticator app, or a passkey sign-in) to open
   * the workspace in the app. Doesn't apply to connected apps (MCP), which use their own tokens.
   */
  requireTwoFactor: boolean;
  /** Who may create teamspaces. Guests never can. */
  teamspaceCreation: "owners" | "members";
  /**
   * How members may sign in to open the workspace: any way, or only through its single sign-on
   * (its own connection, or the instance's provider). Owners keep their other ways in, so a broken
   * identity provider can't lock the workspace; guests are outside it. Like two-step verification,
   * it doesn't apply to connected apps (MCP) or API tokens.
   */
  loginMethod: "any" | "sso";
  /**
   * The AI writing assistant and AI autofill properties, when the server has an AI provider (see
   * server/ai). Owners can turn them off so no page content of the workspace goes to the provider.
   */
  ai: boolean;
  /**
   * Days a page stays in the trash before the daily cleanup deletes it for good, with its files
   * (see server/retention.ts); 0 keeps it until someone deletes it. One of TRASH_RETENTION_CHOICES.
   */
  trashRetentionDays: number;
  /**
   * Whether someone who opens a link to a page they can't see may ask for access from the "You
   * don't have access" screen (see server/access-requests.ts). Guests and people outside the
   * workspace too: approving brings them in as guests, which the guest invite policy decides.
   */
  accessRequests: boolean;
};

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  guestInvites: "owners",
  guestPrivatePages: false,
  publishing: "members",
  requireTwoFactor: false,
  teamspaceCreation: "members",
  loginMethod: "any",
  ai: true,
  trashRetentionDays: 30,
  accessRequests: true,
};

export const workspace = pgTable("workspace", {
  id: id(),
  name: text("name").notNull(),
  icon: text("icon"),
  /** Token of the shareable join link (joins as member); null while the link is turned off. */
  inviteLinkToken: text("invite_link_token").unique(),
  /** Only the policies an owner changed; `workspaceSettings` fills in the rest from the defaults. */
  settings: jsonb("settings").$type<Partial<WorkspaceSettings>>().notNull().default({}),
  ...timestamps,
});

/**
 * `owner` and `member` see every page unless a page permission restricts it; a `guest` sees only
 * pages shared with them and can't create top-level pages or see who else is in the workspace.
 */
export type WorkspaceRole = "owner" | "member" | "guest";

export const workspaceMember = pgTable(
  "workspace_member",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").$type<WorkspaceRole>().notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index("workspace_member_user_idx").on(t.userId)],
);

/**
 * A pending invitation for an email that has no account yet. The token in the invitation link is
 * the only way to redeem it, since email addresses are not verified.
 */
export const workspaceInvitation = pgTable(
  "workspace_invitation",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    /** Stored lowercased. */
    email: text("email").notNull(),
    role: text("role").$type<WorkspaceRole>().notNull().default("member"),
    token: text("token").notNull().unique(),
    invitedBy: text("invited_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("workspace_invitation_email_idx").on(t.workspaceId, t.email)],
);

/**
 * Who sees a teamspace and its pages (see `page_access_level`): owners and members of the
 * workspace only. Guests are never in a teamspace; they get single pages shared with them.
 * - `default`: every owner and member is in it and can't leave it.
 * - `open`: everyone sees it and can join; those who haven't can read and comment on its pages.
 * - `closed`: everyone sees that it exists, but only its members open its pages; its owners add them.
 * - `private`: only its members know it exists.
 */
export const TEAMSPACE_ACCESS = ["default", "open", "closed", "private"] as const;
export type TeamspaceAccess = (typeof TEAMSPACE_ACCESS)[number];
/** Teamspace owners change its settings and members; members add and edit its pages. */
export type TeamspaceRole = "owner" | "member";

export const teamspace = pgTable(
  "teamspace",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    icon: text("icon"),
    description: text("description").notNull().default(""),
    access: text("access").$type<TeamspaceAccess>().notNull().default("open"),
    /** Archived teamspaces leave the sidebar and take no new pages; their pages keep their access. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    // Target of the page's (teamspace_id, workspace_id) key: a page never sits in another workspace's teamspace.
    unique("teamspace_id_workspace_key").on(t.id, t.workspaceId),
    index("teamspace_workspace_idx").on(t.workspaceId),
    check("teamspace_access_check", sql`${t.access} in ('default', 'open', 'closed', 'private')`),
  ],
);

/**
 * Who joined a teamspace, and who owns it. Everyone is in a `default` teamspace without a row;
 * rows there only name its owners.
 */
export const teamspaceMember = pgTable(
  "teamspace_member",
  {
    teamspaceId: text("teamspace_id")
      .notNull()
      .references(() => teamspace.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").$type<TeamspaceRole>().notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.teamspaceId, t.userId] }),
    index("teamspace_member_user_idx").on(t.userId),
    check("teamspace_member_role_check", sql`${t.role} in ('owner', 'member')`),
  ],
);

export type PageKind = "page" | "database";
/** Values of a database row, keyed by property id. */
export type RowProperties = Record<string, unknown>;

export const page = pgTable(
  "page",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    parentId: text("parent_id").references((): AnyPgColumn => page.id, { onDelete: "cascade" }),
    /**
     * The teamspace the page's tree belongs to, set on every page of the tree (a trigger copies the
     * parent's; see drizzle/*_teamspaces.sql). Null for private pages: only the people they are
     * shared with see them.
     */
    teamspaceId: text("teamspace_id"),
    kind: text("kind").$type<PageKind>().notNull().default("page"),
    title: text("title").notNull().default(""),
    icon: text("icon"),
    position: doublePrecision("position").notNull().default(0),
    /** Row values when the parent is a database; empty for regular pages. */
    properties: jsonb("properties").$type<RowProperties>().notNull().default({}),
    /** Encoded Yjs state (Y.encodeStateAsUpdate) — the source of truth for the body. */
    ydoc: bytea("ydoc"),
    /** Derived from ydoc on every store; used for search and MCP reads. */
    contentText: text("content_text").notNull().default(""),
    contentMarkdown: text("content_markdown").notNull().default(""),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /** Databases: while set, properties and views can't be added, renamed or removed. Rows stay editable. */
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    /**
     * A template (see server/templates.ts): a top-level page of the workspace's template picker, or
     * a row template of its parent database. New pages and rows are copied from it.
     */
    isTemplate: boolean("is_template").notNull().default(false),
    /**
     * The page is a template or lies under one. Such pages stay out of the sidebar, search, trash,
     * favorites, published sites and relation pickers. Database views leave out only the row
     * templates themselves (`isTemplate`), so a database kept as a template still shows its rows.
     */
    inTemplate: boolean("in_template").notNull().default(false),
    /** Databases: the row template "New" starts from; null for a blank row. */
    defaultTemplateId: text("default_template_id").references((): AnyPgColumn => page.id, { onDelete: "set null" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("page_workspace_parent_idx").on(t.workspaceId, t.parentId, t.position),
    index("page_teamspace_idx").on(t.teamspaceId),
    foreignKey({
      name: "page_teamspace_fk",
      columns: [t.teamspaceId, t.workspaceId],
      foreignColumns: [teamspace.id, teamspace.workspaceId],
    }),
    index("page_template_idx").on(t.workspaceId, t.parentId).where(sql`${t.isTemplate}`),
    index("page_search_idx").using(
      "gin",
      sql`to_tsvector('simple', coalesce(${t.title}, '') || ' ' || coalesce(${t.contentText}, ''))`,
    ),
  ],
);

export { PROPERTY_TYPES, type PropertyType, type StatusGroup };
/** An option of a select, multi-select or status property. Status options belong to a `group`. */
export type SelectOption = { id: string; name: string; color: string; group?: StatusGroup };
/** One entry of a checklist value; the value is a list of these, in order. */
export type ChecklistItem = { id: string; text: string; checked: boolean };
/**
 * A relation links rows of this database to rows of another database in the same workspace.
 * Values are arrays of row ids. A two-way relation has a paired relation property on the target
 * database that is kept in sync (`pairedPropertyId`).
 */
export type RelationConfig = { databaseId: string; pairedPropertyId?: string | null };
/**
 * A formula property's expression. `prop("…")` references hold property ids (or "title"), so
 * renaming a property keeps its formulas working; editors show names instead (see lib/derived).
 */
export type FormulaConfig = {
  expression: string;
  /** What the formula evaluates to. Worked out whenever properties are read; never stored. */
  type?: FormulaResultType;
};
/**
 * A rollup: `function` over the values of `targetPropertyId` (a property of the related
 * database, or "title") in the rows this row links to through `relationPropertyId`.
 * "show_original" lists the values instead of calculating one. `display` shows a percentage as
 * a number (the default), a bar or a ring.
 */
export type RollupConfig = {
  relationPropertyId: string;
  targetPropertyId: string;
  function: RollupFn;
  display?: RollupDisplay;
};
export type PropertyOptions = {
  options?: SelectOption[];
  relation?: RelationConfig;
  formula?: FormulaConfig;
  rollup?: RollupConfig;
  /** Text properties: AI autofill (see lib/ai and server/ai-properties). */
  ai?: AiAutofillConfig;
};

export const databaseProperty = pgTable(
  "database_property",
  {
    id: id(),
    databaseId: text("database_id")
      .notNull()
      .references(() => page.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").$type<PropertyType>().notNull(),
    options: jsonb("options").$type<PropertyOptions>().notNull().default({}),
    position: doublePrecision("position").notNull().default(0),
    ...timestamps,
  },
  (t) => [index("database_property_db_idx").on(t.databaseId)],
);

export type ViewType = "table" | "board" | "calendar" | "gallery" | "list" | "timeline" | "chart" | "form";
/** Grouping by a date: one group per day, week (Monday to Sunday), month or year. */
export type GroupDateBy = "day" | "week" | "month" | "year";
export type GroupStatusBy = "option" | "group";
export type SortRule = { propertyId: string; direction: "asc" | "desc" };
export type FilterOp = "contains" | "equals" | "not_equals" | "is_empty" | "is_not_empty" | "gt" | "lt" | "is_within";
/** Values of an `is_within` rule: date ranges relative to the day the view is looked at. */
export type RelativeDateRange = "today" | "this_week" | "this_month" | "past_n_days" | "next_n_days";
/** `days` is only used by `is_within` rules with a `past_n_days` / `next_n_days` value. */
export type FilterRule = { propertyId: string; op: FilterOp; value?: unknown; days?: number };
export type FilterCombinator = "and" | "or";
/** Rules combined with their own and/or; groups nest at most MAX_FILTER_DEPTH levels (see lib/filters). */
export type FilterGroup = { type: "group"; combinator: FilterCombinator; rules: FilterEntry[] };
export type FilterEntry = FilterRule | FilterGroup;
/** Gallery card sizes. */
export type CardSize = "small" | "medium" | "large";
/**
 * Where gallery cards take their cover from: the first image in the row's body, the first image of
 * a files property, or nowhere.
 */
export type ViewCover = { source: "first_image" } | { source: "none" } | { source: "property"; propertyId: string };
/** Timeline scale: a column per day, per week or per month. */
export type TimelineZoom = "day" | "week" | "month";
/** Chart kinds: vertical bars (columns), horizontal bars, a line, or a donut (a pie with a hole). */
export type ChartType = "bar" | "horizontal_bar" | "line" | "donut";
/** Chart group order: the grouping's own order (see lib/grouping), or by value. */
export type ChartSort = "group" | "value_desc" | "value_asc";
/** What a chart measures per group instead of counting rows: a calculation over one property. */
export type ChartAggregate = { fn: AggregateFn; propertyId: string };
/** One question of a form view: a property (or "title", the row's name) the form asks for. */
export type FormQuestion = {
  propertyId: string;
  /** Submitting needs an answer; for a checkbox, a tick. */
  required?: boolean;
  /** Shown instead of the property's name. */
  label?: string;
  /** Help text under the question. */
  description?: string;
};
/**
 * A form view: the questions it asks, in order, and what happens to the row it creates. Whether
 * it is open to people outside the workspace lives in `form_publication`, not here, so editing a
 * view (or copying a database) never turns a public link on.
 */
export type FormConfig = {
  /** Heading of the form; the database's title when missing. */
  title?: string;
  description?: string;
  questions?: FormQuestion[];
  /**
   * Values every row from the form gets for properties it doesn't ask (Status = New), stored like
   * row values (option, user and row ids).
   */
  defaults?: Record<string, unknown>;
  /** Shown after submitting; a generic thank-you when missing. */
  confirmation?: string;
  /** Whether the thank-you screen offers to fill the form in again; true when missing. */
  allowAnother?: boolean;
};
export type ViewConfig = {
  /** Boards: the column property. Timelines: optional swimlanes (none when missing). Charts: the bars, points or slices. */
  groupBy?: string;
  /** Calendar views: the date property that places rows on days. Timelines: where bars start. */
  dateBy?: string;
  /** Timelines: the date property where bars end; without it bars are one day long. */
  endDateBy?: string;
  /** Timelines: "week" when missing. */
  zoom?: TimelineZoom;
  /** Timelines: whether the table of row titles shows left of the bars; shown when missing. */
  showTable?: boolean;
  /** Galleries: "medium" when missing. */
  cardSize?: CardSize;
  /** Galleries: the first image of each row when missing. */
  cover?: ViewCover;
  /** Charts: "bar" when missing. */
  chartType?: ChartType;
  /** Charts: counts rows per group when missing. */
  chartAggregate?: ChartAggregate;
  /** Bar charts: splits each bar into segments by a second property (only for measures that add up). */
  stackBy?: string;
  /** Charts: "group" when missing. */
  chartSort?: ChartSort;
  /** Charts: print each value on its bar or point, and in the donut's legend. */
  showValues?: boolean;
  /** Donut charts: the legend beside the donut; shown when missing. */
  showLegend?: boolean;
  sorts?: SortRule[];
  /** Rules and groups; plain rule lists from before groups existed are still valid. */
  filters?: FilterEntry[];
  /** How the top-level filters combine; missing means "and". */
  filterCombinator?: FilterCombinator;
  hidden?: string[];
  /** Properties shown although their type starts hidden in this kind of view (see `isHiddenInView`). */
  shown?: string[];
  /** Date grouping (date, created and last edited time): how big each group is; "month" when missing. */
  groupDateBy?: GroupDateBy;
  /** Status grouping: one group per option (the default), or per stage (to do, in progress, done). */
  groupStatusBy?: GroupStatusBy;
  /** Board, table and chart views: group order by group key (see lib/grouping), "" for no value. Unlisted groups follow in their natural order. */
  groupOrder?: string[];
  /** Board, table and chart views: groups the user hid, by group key ("" for no value). */
  hiddenGroups?: string[];
  /** Board, table and chart views: leave out groups without rows (the no-value group only shows with rows anyway). */
  hideEmptyGroups?: boolean;
  /** Table views: groups shown collapsed, by group key. */
  collapsedGroups?: string[];
  /** Table views: the footer calculation per column, keyed by property id or "title". */
  calculations?: Record<string, AggregateFn>;
  /** Form views: questions, texts and default values. */
  form?: FormConfig;
};

export const databaseView = pgTable(
  "database_view",
  {
    id: id(),
    databaseId: text("database_id")
      .notNull()
      .references(() => page.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").$type<ViewType>().notNull().default("table"),
    config: jsonb("config").$type<ViewConfig>().notNull().default({}),
    position: doublePrecision("position").notNull().default(0),
    /**
     * Shown where the database is published, with visitors switching between these views. When
     * no view of the database is marked, published pages show its first view (see publication.ts).
     */
    published: boolean("published").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("database_view_db_idx").on(t.databaseId)],
);

/** `before_ai_edit`: saved before the editor's AI writing assistant applied a suggestion. */
export type SnapshotReason = "auto" | "before_mcp_write" | "before_restore" | "before_ai_edit" | "manual";

export const pageSnapshot = pgTable(
  "page_snapshot",
  {
    id: id(),
    pageId: text("page_id")
      .notNull()
      .references(() => page.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    ydoc: bytea("ydoc").notNull(),
    contentMarkdown: text("content_markdown").notNull().default(""),
    reason: text("reason").$type<SnapshotReason>().notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    /** OAuth client that triggered the write, for MCP-originated snapshots. */
    oauthClientId: text("oauth_client_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("page_snapshot_page_idx").on(t.pageId, t.createdAt)],
);
