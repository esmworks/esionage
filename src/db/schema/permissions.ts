import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { page, workspace } from "./app";
import { user } from "./auth";

/**
 * Stored access levels, weakest first. `none` on a page takes away what an ancestor gave;
 * `comment` reads the page and comments on it without editing it.
 */
export const PAGE_LEVELS = ["none", "view", "comment", "edit", "full"] as const;
export type PageLevel = (typeof PAGE_LEVELS)[number];

/**
 * Who may do what on a page and, unless a descendant says otherwise, everything under it.
 * `userId` null means everyone with a member role in the workspace. The rules live in the SQL
 * function `page_access_level` (see the migration), which the app calls for every check.
 */
export const pagePermission = pgTable(
  "page_permission",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    pageId: text("page_id")
      .notNull()
      .references(() => page.id, { onDelete: "cascade" }),
    /** Copied from the page so the "no permissions in this workspace" fast path is one index lookup. */
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    level: text("level").$type<PageLevel>().notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("page_permission_principal_key").on(t.pageId, t.userId).nullsNotDistinct(),
    index("page_permission_workspace_idx").on(t.workspaceId),
    index("page_permission_user_idx").on(t.userId),
    check("page_permission_level_check", sql`${t.level} in ('none', 'view', 'comment', 'edit', 'full')`),
  ],
);

/**
 * A page shared by email with someone who has no account yet. It waits beside their workspace
 * invitation and turns into a page permission when they accept it or join by link.
 */
export const pageInvitation = pgTable(
  "page_invitation",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    pageId: text("page_id")
      .notNull()
      .references(() => page.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    /** Stored lowercased, like workspace invitations. */
    email: text("email").notNull(),
    level: text("level").$type<PageLevel>().notNull(),
    invitedBy: text("invited_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("page_invitation_email_key").on(t.pageId, t.email),
    index("page_invitation_workspace_email_idx").on(t.workspaceId, t.email),
    check("page_invitation_level_check", sql`${t.level} in ('view', 'comment', 'edit', 'full')`),
  ],
);
