import { index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { page } from "./app";
import { user } from "./auth";

/** Pages a user starred; listed under Favorites in their sidebar. Private to that user. */
export const pageFavorite = pgTable(
  "page_favorite",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    pageId: text("page_id")
      .notNull()
      .references(() => page.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.pageId] }), index("page_favorite_page_idx").on(t.pageId)],
);

/**
 * A page published to the web: anyone with the link can read it without signing in. The token is
 * the only way in, so unpublishing (deleting the row) or publishing again with a new token cuts off
 * old links.
 */
export const pagePublication = pgTable("page_publication", {
  pageId: text("page_id")
    .primaryKey()
    .references(() => page.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  publishedBy: text("published_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
