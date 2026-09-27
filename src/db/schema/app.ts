import { sql } from "drizzle-orm";
import {
  customType,
  doublePrecision,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type { AggregateFn } from "../../lib/aggregate";
import { PROPERTY_TYPES, type PropertyType } from "../../lib/property-types";
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
};

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  guestInvites: "owners",
  guestPrivatePages: false,
  publishing: "members",
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
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("page_workspace_parent_idx").on(t.workspaceId, t.parentId, t.position),
    index("page_search_idx").using(
      "gin",
      sql`to_tsvector('simple', coalesce(${t.title}, '') || ' ' || coalesce(${t.contentText}, ''))`,
    ),
  ],
);

export { PROPERTY_TYPES, type PropertyType };
export type SelectOption = { id: string; name: string; color: string };
/**
 * A relation links rows of this database to rows of another database in the same workspace.
 * Values are arrays of row ids. A two-way relation has a paired relation property on the target
 * database that is kept in sync (`pairedPropertyId`).
 */
export type RelationConfig = { databaseId: string; pairedPropertyId?: string | null };
export type PropertyOptions = { options?: SelectOption[]; relation?: RelationConfig };

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

export type ViewType = "table" | "board" | "calendar";
export type SortRule = { propertyId: string; direction: "asc" | "desc" };
export type FilterOp = "contains" | "equals" | "not_equals" | "is_empty" | "is_not_empty" | "gt" | "lt";
export type FilterRule = { propertyId: string; op: FilterOp; value?: unknown };
export type ViewConfig = {
  groupBy?: string;
  /** Calendar views: the date property that places rows on days. */
  dateBy?: string;
  sorts?: SortRule[];
  filters?: FilterRule[];
  hidden?: string[];
  /** Properties shown although their type starts hidden in this kind of view (see `isHiddenInView`). */
  shown?: string[];
  /** Board views: column order by option id, "" for the no-value column. Unlisted options follow in option order. */
  groupOrder?: string[];
  /** Board views: columns the user hid, by option id ("" for no value). */
  hiddenGroups?: string[];
  /** Table views: the footer calculation per column, keyed by property id or "title". */
  calculations?: Record<string, AggregateFn>;
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
    ...timestamps,
  },
  (t) => [index("database_view_db_idx").on(t.databaseId)],
);

export type SnapshotReason = "auto" | "before_mcp_write" | "before_restore" | "manual";

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
