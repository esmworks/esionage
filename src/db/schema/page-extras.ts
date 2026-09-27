import { boolean, index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { databaseView, page } from "./app";
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

/**
 * A form view open to people outside the workspace (`/f/<token>`): anyone with the link can add a
 * row through it, signed in or, with `anonymous`, without an account. Like a published page, the
 * token is the only way in, and the form stops taking answers once the person who opened it loses
 * edit access to the database. Copies of the database never carry the row along.
 */
export const formPublication = pgTable("form_publication", {
  viewId: text("view_id")
    .primaryKey()
    .references(() => databaseView.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  /** Answers without signing in, and without recording who answered even when signed in. */
  anonymous: boolean("anonymous").notNull().default(false),
  publishedBy: text("published_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
