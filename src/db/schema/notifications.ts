import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { databaseProperty, page, workspace, workspaceJoinRequest } from "./app";
import { user } from "./auth";

/** Account-wide choices that follow the user across browsers (the interface language doesn't). */
export const userPreference = pgTable("user_preference", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /** Email me when someone assigns me to a database row. */
  assignmentEmails: boolean("assignment_emails").notNull().default(true),
  /** Show assignments in my inbox. */
  assignmentInbox: boolean("assignment_inbox").notNull().default(true),
  /** Email me when someone shares a page with me. */
  shareEmails: boolean("share_emails").notNull().default(true),
  /** Show pages shared with me in my inbox. */
  shareInbox: boolean("share_inbox").notNull().default(true),
  /** Email me when someone replies in a comment thread I'm part of. */
  commentEmails: boolean("comment_emails").notNull().default(true),
  /** Show replies to my comment threads in my inbox. */
  commentInbox: boolean("comment_inbox").notNull().default(true),
  /** Email me when someone mentions me on a page. */
  mentionEmails: boolean("mention_emails").notNull().default(true),
  /** Show mentions of me in my inbox. */
  mentionInbox: boolean("mention_inbox").notNull().default(true),
  /** Email me the reminders I set on dates. */
  reminderEmails: boolean("reminder_emails").notNull().default(true),
  /** Show the reminders I set on dates in my inbox. */
  reminderInbox: boolean("reminder_inbox").notNull().default(true),
  /** Email me when someone asks to join a workspace I own. */
  joinRequestEmails: boolean("join_request_emails").notNull().default(true),
  /** Show requests to join the workspaces I own in my inbox. */
  joinRequestInbox: boolean("join_request_inbox").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Assignment emails waiting out their delay (see server/assignments). Kept in the database so a
 * restart doesn't lose them; one row per person per cell, so quick edits send a single email.
 */
export const pendingAssignmentEmail = pgTable(
  "assignment_email",
  {
    rowId: text("row_id")
      .notNull()
      .references(() => page.id, { onDelete: "cascade" }),
    propertyId: text("property_id")
      .notNull()
      .references(() => databaseProperty.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    /** The assigner's interface language when they made the change. */
    locale: text("locale").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.rowId, t.propertyId, t.userId] }), index("assignment_email_due_idx").on(t.dueAt)],
);

export const NOTIFICATION_KINDS = ["assignment", "page_shared", "comment", "mention", "reminder", "join_request"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/**
 * A user's inbox, per workspace. "assignment": `actorId` added the user to the person property
 * `propertyId` of row `pageId`. "page_shared": `actorId` gave the user their own access to page
 * `pageId`. "comment": `actorId` replied in comment thread `threadId` on page `pageId`, where the
 * user had commented before. "mention": `actorId` mentioned the user on page `pageId` (mention
 * `mentionId`). "reminder": the reminder the user set on date mention `mentionId` of page `pageId`
 * fell due. "join_request": `actorId` asked to join (or to invite someone), request `joinRequestId`,
 * which waits for the workspace's owners; it has no page. Unread ones are dropped when the change
 * is undone (or the request decided). Rows are recorded
 * whatever the user's preferences; the inbox leaves out the kinds they turned off.
 */
export const notification = pgTable(
  "notification",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    kind: text("kind").$type<NotificationKind>().notNull(),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    /** Every kind but join_request. */
    pageId: text("page_id").references(() => page.id, { onDelete: "cascade" }),
    propertyId: text("property_id").references(() => databaseProperty.id, { onDelete: "cascade" }),
    /** Comment notifications: the thread (in the page's document) they are about. */
    threadId: text("thread_id"),
    /** Mention and reminder notifications: the mention (in the page's document) they are about. */
    mentionId: text("mention_id"),
    /** Join request notifications: the request. */
    joinRequestId: text("join_request_id").references(() => workspaceJoinRequest.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
    /** When to email the user about it (all but assignment); cleared once the email is handled. */
    emailDueAt: timestamp("email_due_at", { withTimezone: true }),
    /** The actor's interface language, for that email. */
    emailLocale: text("email_locale"),
  },
  (t) => [
    index("notification_inbox_idx").on(t.userId, t.workspaceId, t.createdAt),
    index("notification_email_due_idx").on(t.emailDueAt),
    check("notification_subject_check", sql`${t.kind} = 'join_request' or ${t.pageId} is not null`),
  ],
);
