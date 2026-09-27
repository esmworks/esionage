import { boolean, index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { databaseProperty, page } from "./app";
import { user } from "./auth";

/** Account-wide choices that follow the user across browsers (the interface language doesn't). */
export const userPreference = pgTable("user_preference", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /** Email me when someone assigns me to a database row. */
  assignmentEmails: boolean("assignment_emails").notNull().default(true),
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
