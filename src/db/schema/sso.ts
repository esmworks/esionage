import { boolean, foreignKey, index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { workspace } from "./app";
import { ssoProvider, user } from "./auth";
import { memberGroup } from "./groups";

/**
 * A workspace's single sign-on connection (one per workspace): which `sso_provider` row is its
 * (the SSO plugin's table holds the OIDC or SAML settings, the email domains and whether they are
 * verified), and the token its DNS records must carry to verify those domains. Removing the
 * connection or the workspace removes the provider too (trigger in drizzle/0022_sso.sql).
 */
export const workspaceSso = pgTable("workspace_sso", {
  workspaceId: text("workspace_id")
    .primaryKey()
    .references(() => workspace.id, { onDelete: "cascade" }),
  providerId: text("provider_id")
    .notNull()
    .unique()
    .references(() => ssoProvider.providerId, { onDelete: "cascade" }),
  protocol: text("protocol").$type<"oidc" | "saml">().notNull(),
  /** Goes into the `_esionage-sso.<domain>` TXT record; a new one when the domains change. */
  verificationToken: text("verification_token").notNull(),
  createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * SCIM tokens: an identity provider uses one to add and remove the workspace's members (/scim/v2).
 * Like API tokens, only a SHA-256 hash of the secret is kept; it is shown once. Revoking deletes it.
 */
export const scimToken = pgTable(
  "scim_token",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** The start of the secret ("scim_" and a few characters), to tell tokens apart in lists. */
    prefix: text("prefix").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Updated at most once a minute. */
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [index("scim_token_workspace_idx").on(t.workspaceId)],
);

/**
 * People an identity provider manages through SCIM in a workspace. A deactivated one (`active`
 * false) has been removed from the workspace but stays known to SCIM, so the provider can turn them
 * back on, and single sign-on doesn't add them back by their email domain.
 */
export const scimIdentity = pgTable(
  "scim_identity",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The provider's own id for the person (SCIM `externalId`). */
    externalId: text("external_id"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index("scim_identity_user_idx").on(t.userId)],
);

/**
 * Member groups an identity provider created or changed over SCIM (/scim/v2/Groups), with its own id
 * for them (SCIM `externalId`). The group itself is an ordinary `member_group`; this row marks it as
 * provisioned (Settings > Groups says so) and goes with the group when it is deleted.
 */
export const scimGroup = pgTable(
  "scim_group",
  {
    groupId: text("group_id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    externalId: text("external_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("scim_group_workspace_idx").on(t.workspaceId),
    foreignKey({
      name: "scim_group_group_fk",
      columns: [t.groupId, t.workspaceId],
      foreignColumns: [memberGroup.id, memberGroup.workspaceId],
    }).onDelete("cascade"),
  ],
);
