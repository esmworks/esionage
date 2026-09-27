import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { workspace } from "./app";
import { user } from "./auth";

/** What a personal access token may do (the same names as the MCP OAuth scopes). */
export const API_TOKEN_SCOPES = ["pages:read", "pages:write"] as const;
export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

/**
 * Personal access tokens for the REST API (/api/v1). A token acts as its user, with the user's own
 * page access, narrowed by its scopes and, optionally, to one workspace. Only a SHA-256 hash of the
 * secret is kept: it is shown once, when it is created. Revoking deletes the row.
 */
export const apiToken = pgTable(
  "api_token",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** The start of the secret ("esi_" and a few characters), to tell tokens apart in lists. */
    prefix: text("prefix").notNull(),
    /** Hex SHA-256 of the whole secret. */
    tokenHash: text("token_hash").notNull().unique(),
    scopes: text("scopes").array().notNull(),
    /** Only pages of this workspace; any of the user's workspaces when null. */
    workspaceId: text("workspace_id").references(() => workspace.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /** Updated at most once a minute. */
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("api_token_user_idx").on(t.userId)],
);
