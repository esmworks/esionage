import { index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { databaseProperty, page } from "./app";
import { user } from "./auth";

/**
 * Where an AI autofill value of a row stands (see server/ai-properties.ts): waiting or being worked
 * out ("pending"), failed ("error", with an AiErrorCode) or done. The value itself is an ordinary
 * text value in `page.properties`. `sourceHash` fingerprints what the last value was worked out from,
 * so automatic updates only run when the row's inputs really changed.
 */
export type AiPropertyStatus = "pending" | "error" | "done";

export const aiPropertyState = pgTable(
  "ai_property_state",
  {
    rowId: text("row_id")
      .notNull()
      .references(() => page.id, { onDelete: "cascade" }),
    propertyId: text("property_id")
      .notNull()
      .references(() => databaseProperty.id, { onDelete: "cascade" }),
    status: text("status").$type<AiPropertyStatus>().notNull(),
    /** An AiErrorCode while `status` is "error". */
    error: text("error"),
    sourceHash: text("source_hash"),
    /** Who asked for the value last; the job runs with their access. */
    requestedBy: text("requested_by").references(() => user.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.rowId, t.propertyId] }), index("ai_property_state_property_idx").on(t.propertyId)],
);
