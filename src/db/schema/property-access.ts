import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { databaseProperty, page } from "./app";
import { user } from "./auth";
import { memberGroup } from "./groups";
import { PROPERTY_LEVELS, type PropertyLevel } from "../../lib/property-access";

export { PROPERTY_LEVELS, type PropertyLevel };

/**
 * Who may see and change one property of a database ("Property access"). A property without
 * entries follows the database's access. With entries, the one for everyone (no principal) sets
 * the level of everyone with access to the database, and the others raise it for one person, a
 * group, or whoever a person property of the row names. Nobody gets more than their access to the
 * database allows, and people with full access to it are never restricted (see lib/property-access).
 */
export const propertyPermission = pgTable(
  "property_permission",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    propertyId: text("property_id")
      .notNull()
      .references(() => databaseProperty.id, { onDelete: "cascade" }),
    /** Copied from the property so a database's rules load in one index lookup. */
    databaseId: text("database_id")
      .notNull()
      .references(() => page.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    groupId: text("group_id"),
    /** A person (or created by) property of the same database: the people it names in a row. */
    personPropertyId: text("person_property_id").references(() => databaseProperty.id, { onDelete: "cascade" }),
    level: text("level").$type<PropertyLevel>().notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("property_permission_principal_key").on(t.propertyId, t.userId, t.groupId, t.personPropertyId).nullsNotDistinct(),
    index("property_permission_database_idx").on(t.databaseId),
    index("property_permission_user_idx").on(t.userId),
    index("property_permission_group_idx").on(t.groupId),
    foreignKey({
      name: "property_permission_group_fk",
      columns: [t.groupId, t.workspaceId],
      foreignColumns: [memberGroup.id, memberGroup.workspaceId],
    }).onDelete("cascade"),
    check("property_permission_principal_check", sql`num_nonnulls(${t.userId}, ${t.groupId}, ${t.personPropertyId}) <= 1`),
    check(
      "property_permission_level_check",
      sql`${t.level} in ('none', 'view_property', 'view', 'edit_values', 'edit')`,
    ),
  ],
);
