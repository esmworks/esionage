import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  databaseProperty,
  databaseView,
  page,
  PROPERTY_TYPES,
  type PropertyOptions,
  type PropertyType,
  type SelectOption,
  type ViewConfig,
  type ViewType,
} from "@/db/schema";
import { applyView, normalizeValue, PropertyValueError, SELECT_COLORS } from "@/lib/properties";
import { AccessError, requirePageAccess } from "@/server/access";
import { getCollab } from "@/server/collab/bridge";

export type DatabaseProperty = typeof databaseProperty.$inferSelect;
export type DatabaseView = typeof databaseView.$inferSelect;
export type DatabaseRow = {
  id: string;
  title: string;
  icon: string | null;
  properties: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

async function requireDatabase(userId: string, databaseId: string) {
  const p = await requirePageAccess(userId, databaseId);
  if (p.kind !== "database") throw new AccessError("Not a database");
  return p;
}

function notifyRows(databaseId: string) {
  getCollab().broadcast(`db:${databaseId}`, "rows");
}
function notifySchema(databaseId: string) {
  getCollab().broadcast(`db:${databaseId}`, "schema");
}

export async function getProperties(databaseId: string) {
  return db
    .select()
    .from(databaseProperty)
    .where(eq(databaseProperty.databaseId, databaseId))
    .orderBy(asc(databaseProperty.position), asc(databaseProperty.createdAt));
}

export async function getDatabase(userId: string, databaseId: string) {
  const database = await requireDatabase(userId, databaseId);
  const [properties, views] = await Promise.all([
    getProperties(databaseId),
    db
      .select()
      .from(databaseView)
      .where(eq(databaseView.databaseId, databaseId))
      .orderBy(asc(databaseView.position), asc(databaseView.createdAt)),
  ]);
  return { database, properties, views };
}

export async function listRows(userId: string, databaseId: string, config: ViewConfig = {}) {
  await requireDatabase(userId, databaseId);
  const [rows, properties] = await Promise.all([
    db
      .select({
        id: page.id,
        title: page.title,
        icon: page.icon,
        properties: page.properties,
        createdAt: page.createdAt,
        updatedAt: page.updatedAt,
      })
      .from(page)
      .where(and(eq(page.parentId, databaseId), isNull(page.archivedAt)))
      .orderBy(asc(page.position), asc(page.createdAt)),
    getProperties(databaseId),
  ]);
  return applyView<DatabaseRow>(rows, config, properties);
}

/**
 * Validates row values keyed by property id or (case-insensitive) name and returns them keyed
 * by id. Unknown keys are rejected so agents learn the schema instead of silently losing data.
 */
export async function normalizeRowProperties(databaseId: string, input: Record<string, unknown>) {
  const props = await getProperties(databaseId);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    const prop = props.find((p) => p.id === key) ?? props.find((p) => p.name.toLowerCase() === key.toLowerCase());
    if (!prop) {
      throw new PropertyValueError(
        `Unknown property "${key}". Available: ${props.map((p) => `${p.name} (${p.type})`).join(", ") || "none"}`,
      );
    }
    out[prop.id] = normalizeValue(prop, value);
  }
  return out;
}

export async function updateRowProperties(userId: string, rowId: string, patch: Record<string, unknown>) {
  const row = await requirePageAccess(userId, rowId);
  if (!row.parentId) throw new Error("Page is not a database row");
  await requireDatabase(userId, row.parentId);
  const normalized = await normalizeRowProperties(row.parentId, patch);
  const next = { ...row.properties };
  for (const [id, value] of Object.entries(normalized)) {
    if (value === null) delete next[id];
    else next[id] = value;
  }
  await db.update(page).set({ properties: next, updatedBy: userId }).where(eq(page.id, rowId));
  notifyRows(row.parentId);
  return next;
}

export async function addProperty(
  userId: string,
  databaseId: string,
  input: { name: string; type: PropertyType; options?: string[] },
) {
  await requireDatabase(userId, databaseId);
  if (!PROPERTY_TYPES.includes(input.type)) throw new PropertyValueError(`Unsupported type "${input.type}"`);
  const [{ max }] = await db
    .select({ max: sql<number | null>`max(${databaseProperty.position})` })
    .from(databaseProperty)
    .where(eq(databaseProperty.databaseId, databaseId));
  const options: PropertyOptions =
    input.type === "select" || input.type === "multi_select"
      ? { options: (input.options ?? []).map((name, i) => makeOption(name, i)) }
      : {};
  const [created] = await db
    .insert(databaseProperty)
    .values({
      databaseId,
      name: input.name.trim() || "Property",
      type: input.type,
      options,
      position: (Number(max) || 0) + 1,
    })
    .returning();
  notifySchema(databaseId);
  return created;
}

export function makeOption(name: string, index = 0): SelectOption {
  return { id: crypto.randomUUID(), name: name.trim(), color: SELECT_COLORS[index % SELECT_COLORS.length] };
}

async function requireProperty(userId: string, propertyId: string) {
  const [prop] = await db.select().from(databaseProperty).where(eq(databaseProperty.id, propertyId));
  if (!prop) throw new AccessError();
  await requireDatabase(userId, prop.databaseId);
  return prop;
}

export async function updateProperty(
  userId: string,
  propertyId: string,
  patch: { name?: string; options?: SelectOption[]; position?: number },
) {
  const prop = await requireProperty(userId, propertyId);
  await db
    .update(databaseProperty)
    .set({
      ...(patch.name !== undefined ? { name: patch.name.trim() || prop.name } : {}),
      ...(patch.options !== undefined ? { options: { ...prop.options, options: patch.options } } : {}),
      ...(patch.position !== undefined ? { position: patch.position } : {}),
    })
    .where(eq(databaseProperty.id, propertyId));
  notifySchema(prop.databaseId);
}

/** Adds a select option by name if missing and returns it (used when typing a new tag). */
export async function ensureOption(userId: string, propertyId: string, name: string) {
  const prop = await requireProperty(userId, propertyId);
  if (prop.type !== "select" && prop.type !== "multi_select") throw new Error("Not a select property");
  const options = prop.options.options ?? [];
  const existing = options.find((o) => o.name.toLowerCase() === name.trim().toLowerCase());
  if (existing) return existing;
  const option = makeOption(name, options.length);
  await db
    .update(databaseProperty)
    .set({ options: { ...prop.options, options: [...options, option] } })
    .where(eq(databaseProperty.id, propertyId));
  notifySchema(prop.databaseId);
  return option;
}

export async function deleteProperty(userId: string, propertyId: string) {
  const prop = await requireProperty(userId, propertyId);
  await db.transaction(async (tx) => {
    await tx.delete(databaseProperty).where(eq(databaseProperty.id, propertyId));
    await tx
      .update(page)
      .set({ properties: sql`${page.properties} - ${propertyId}` })
      .where(eq(page.parentId, prop.databaseId));
    // Drop references from view configs.
    const views = await tx.select().from(databaseView).where(eq(databaseView.databaseId, prop.databaseId));
    for (const view of views) {
      const c = view.config;
      await tx
        .update(databaseView)
        .set({
          config: {
            ...c,
            groupBy: c.groupBy === propertyId ? undefined : c.groupBy,
            sorts: c.sorts?.filter((s) => s.propertyId !== propertyId),
            filters: c.filters?.filter((f) => f.propertyId !== propertyId),
            hidden: c.hidden?.filter((h) => h !== propertyId),
          },
        })
        .where(eq(databaseView.id, view.id));
    }
  });
  notifySchema(prop.databaseId);
}

export async function addView(userId: string, databaseId: string, input: { name: string; type: ViewType }) {
  await requireDatabase(userId, databaseId);
  const props = await getProperties(databaseId);
  const groupBy = input.type === "board" ? props.find((p) => p.type === "select")?.id : undefined;
  const [{ max }] = await db
    .select({ max: sql<number | null>`max(${databaseView.position})` })
    .from(databaseView)
    .where(eq(databaseView.databaseId, databaseId));
  const [created] = await db
    .insert(databaseView)
    .values({
      databaseId,
      name: input.name.trim() || (input.type === "board" ? "Board" : "Table"),
      type: input.type,
      config: groupBy ? { groupBy } : {},
      position: (Number(max) || 0) + 1,
    })
    .returning();
  notifySchema(databaseId);
  return created;
}

async function requireView(userId: string, viewId: string) {
  const [view] = await db.select().from(databaseView).where(eq(databaseView.id, viewId));
  if (!view) throw new AccessError();
  await requireDatabase(userId, view.databaseId);
  return view;
}

export async function updateView(userId: string, viewId: string, patch: { name?: string; config?: ViewConfig }) {
  const view = await requireView(userId, viewId);
  await db
    .update(databaseView)
    .set({
      ...(patch.name !== undefined ? { name: patch.name.trim() || view.name } : {}),
      ...(patch.config !== undefined ? { config: patch.config } : {}),
    })
    .where(eq(databaseView.id, viewId));
  notifySchema(view.databaseId);
}

export async function deleteView(userId: string, viewId: string) {
  const view = await requireView(userId, viewId);
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(databaseView)
    .where(eq(databaseView.databaseId, view.databaseId));
  if (count <= 1) throw new Error("A database needs at least one view");
  await db.delete(databaseView).where(eq(databaseView.id, viewId));
  notifySchema(view.databaseId);
}

/** Reorders a row (board drag) and optionally changes its group value in one step. */
export async function moveRow(
  userId: string,
  rowId: string,
  { position, groupBy, groupValue }: { position?: number; groupBy?: string; groupValue?: string | null },
) {
  const row = await requirePageAccess(userId, rowId);
  if (!row.parentId) throw new Error("Page is not a database row");
  await requireDatabase(userId, row.parentId);
  const properties = { ...row.properties };
  if (groupBy) {
    if (groupValue) properties[groupBy] = groupValue;
    else delete properties[groupBy];
  }
  await db
    .update(page)
    .set({ properties, ...(position !== undefined ? { position } : {}), updatedBy: userId })
    .where(eq(page.id, rowId));
  notifyRows(row.parentId);
}

export type DatabaseRowWithPosition = DatabaseRow & { position: number };

/**
 * Everything the database UI needs in one round trip. Rows are unfiltered and in manual order
 * (views are applied client-side so switching views and optimistic edits are instant).
 */
export async function getDatabaseSnapshot(userId: string, databaseId: string) {
  const { database, properties, views } = await getDatabase(userId, databaseId);
  const rows: DatabaseRowWithPosition[] = await db
    .select({
      id: page.id,
      title: page.title,
      icon: page.icon,
      properties: page.properties,
      position: page.position,
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
    })
    .from(page)
    .where(and(eq(page.parentId, databaseId), isNull(page.archivedAt)))
    .orderBy(asc(page.position), asc(page.createdAt));
  return {
    database: {
      id: database.id,
      workspaceId: database.workspaceId,
      title: database.title,
      icon: database.icon,
      archived: Boolean(database.archivedAt),
    },
    properties,
    views,
    rows,
  };
}

/** A single row with its database schema, for the property panel on a row page. */
export async function getRow(userId: string, rowId: string) {
  const row = await requirePageAccess(userId, rowId);
  if (!row.parentId) throw new Error("Page is not a database row");
  await requireDatabase(userId, row.parentId);
  const properties = await getProperties(row.parentId);
  return {
    databaseId: row.parentId,
    row: { id: row.id, title: row.title, properties: row.properties },
    properties,
  };
}
