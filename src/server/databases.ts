import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  databaseProperty,
  databaseView,
  page,
  PROPERTY_TYPES,
  type PropertyOptions,
  type PropertyType,
  type RelationConfig,
  type SelectOption,
  type ViewConfig,
  type ViewType,
} from "@/db/schema";
import {
  applyView,
  normalizeValue,
  PropertyValueError,
  SELECT_COLORS,
  type DatabaseErrorCode,
} from "@/lib/properties";
import { AccessError, pageVisibleTo, requireMembership, requirePageAccess, type RequiredLevel } from "@/server/access";
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

/**
 * Tags a guard error with a stable code the UI translates. The class and English message are
 * unchanged, so MCP output and `instanceof` checks behave as before.
 */
export function withCode<E extends Error>(error: E, code: DatabaseErrorCode): E & { code: DatabaseErrorCode } {
  return Object.assign(error, { code });
}

async function requireDatabase(userId: string, databaseId: string, needed: RequiredLevel) {
  const p = await requirePageAccess(userId, databaseId, needed);
  if (p.kind !== "database") throw withCode(new AccessError("Not a database"), "notADatabase");
  return p;
}

function notifyRows(databaseId: string) {
  getCollab().broadcast(`db:${databaseId}`, "rows");
}
function notifySchema(databaseId: string) {
  getCollab().broadcast(`db:${databaseId}`, "schema");
}
/** The sidebar lists database views, so adding, renaming or removing one refreshes the tree. */
function notifyTree(workspaceId: string) {
  getCollab().broadcast(`ws:${workspaceId}`, "tree");
}

export async function getProperties(databaseId: string) {
  return db
    .select()
    .from(databaseProperty)
    .where(eq(databaseProperty.databaseId, databaseId))
    .orderBy(asc(databaseProperty.position), asc(databaseProperty.createdAt));
}

export async function getDatabase(userId: string, databaseId: string) {
  const database = await requireDatabase(userId, databaseId, "view");
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
  // Rows share their database's access; a row page never grants more than its database.
  await requireDatabase(userId, databaseId, "view");
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
export async function normalizeRowProperties(userId: string, databaseId: string, input: Record<string, unknown>) {
  const props = await getProperties(databaseId);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    const prop = props.find((p) => p.id === key) ?? props.find((p) => p.name.toLowerCase() === key.toLowerCase());
    if (!prop) {
      throw new PropertyValueError(
        `Unknown property "${key}". Available: ${props.map((p) => `${p.name} (${p.type})`).join(", ") || "none"}`,
        "unknownProperty",
        { property: key },
      );
    }
    const normalized = normalizeValue(prop, value);
    out[prop.id] = prop.type === "relation" && normalized ? await resolveRelationValue(userId, prop, normalized as string[]) : normalized;
  }
  return out;
}

/**
 * Maps relation input to row ids of the related database. Each entry is a row id (trashed rows
 * included, so existing links survive an edit) or, for agents, the exact title of a live row.
 */
async function resolveRelationValue(userId: string, prop: DatabaseProperty, input: string[]) {
  const targetId = prop.options.relation?.databaseId;
  const invalid = (value: string) =>
    new PropertyValueError(`"${value}" is not a row of the database related to "${prop.name}"`, "invalidRelation", {
      property: prop.name,
    });
  if (!targetId) throw invalid(input[0]);
  // Only rows the user can see can be linked (or found by title).
  const rows = await db
    .select({ id: page.id, title: page.title, archivedAt: page.archivedAt })
    .from(page)
    .where(and(eq(page.parentId, targetId), pageVisibleTo(userId)));
  const ids = new Set(rows.map((r) => r.id));
  const out: string[] = [];
  for (const value of input) {
    let id = ids.has(value) ? value : undefined;
    if (!id) {
      const needle = value.trim().toLowerCase();
      const matches = rows.filter((r) => !r.archivedAt && r.title.trim().toLowerCase() === needle);
      if (matches.length > 1) {
        throw new PropertyValueError(
          `"${value}" matches ${matches.length} rows of the related database; pass a row id instead`,
          "invalidRelation",
          { property: prop.name },
        );
      }
      id = matches[0]?.id;
    }
    if (!id) throw invalid(value);
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

const asIds = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * Mirrors changes of two-way relations onto the paired property of the linked rows. Uses atomic
 * JSONB updates so concurrent edits of the same target row don't overwrite each other.
 */
export async function syncPairedRelations(
  rowId: string,
  databaseId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) {
  const props = await getProperties(databaseId);
  for (const prop of props) {
    const relation = prop.options.relation;
    if (prop.type !== "relation" || !relation?.pairedPropertyId) continue;
    const was = asIds(before[prop.id]);
    const now = asIds(after[prop.id]);
    const added = now.filter((id) => !was.includes(id));
    const removed = was.filter((id) => !now.includes(id));
    if (!added.length && !removed.length) continue;
    const key = relation.pairedPropertyId;
    const path = `{${key}}`;
    const current = sql`coalesce(${page.properties} -> ${key}, '[]'::jsonb)`;
    if (added.length) {
      await db
        .update(page)
        .set({
          properties: sql`jsonb_set(${page.properties}, ${path}::text[], ${current} || to_jsonb(${rowId}::text))`,
        })
        .where(
          and(
            inArray(page.id, added),
            eq(page.parentId, relation.databaseId),
            sql`not (${current} ? ${rowId})`,
          ),
        );
    }
    if (removed.length) {
      await db
        .update(page)
        .set({
          properties: sql`case when (${current} - ${rowId}::text) = '[]'::jsonb then ${page.properties} - ${key}
            else jsonb_set(${page.properties}, ${path}::text[], ${current} - ${rowId}::text) end`,
        })
        .where(and(inArray(page.id, removed), eq(page.parentId, relation.databaseId)));
    }
    notifyRows(relation.databaseId);
  }
}

export async function updateRowProperties(userId: string, rowId: string, patch: Record<string, unknown>) {
  const row = await requirePageAccess(userId, rowId, "edit");
  if (!row.parentId) throw withCode(new Error("Page is not a database row"), "notADatabaseRow");
  await requireDatabase(userId, row.parentId, "view");
  const normalized = await normalizeRowProperties(userId, row.parentId, patch);
  const next = { ...row.properties };
  for (const [id, value] of Object.entries(normalized)) {
    if (value === null) delete next[id];
    else next[id] = value;
  }
  await db.update(page).set({ properties: next, updatedBy: userId }).where(eq(page.id, rowId));
  await syncPairedRelations(rowId, row.parentId, row.properties, next);
  notifyRows(row.parentId);
  return next;
}

export type RelationInput = {
  /** The database whose rows this property links to (same workspace; may be this database). */
  databaseId: string;
  /** Also add a property on the related database that shows the links back. */
  twoWay?: boolean;
  /** Name of that paired property; defaults to this database's title. */
  pairedName?: string;
};

async function nextPropertyPosition(databaseId: string) {
  const [{ max }] = await db
    .select({ max: sql<number | null>`max(${databaseProperty.position})` })
    .from(databaseProperty)
    .where(eq(databaseProperty.databaseId, databaseId));
  return (Number(max) || 0) + 1;
}

/** `name`, or `name 2`, `name 3`… so it doesn't clash with a property of the database. */
async function uniquePropertyName(databaseId: string, name: string) {
  const taken = new Set((await getProperties(databaseId)).map((p) => p.name.trim().toLowerCase()));
  taken.add("title");
  let candidate = name;
  for (let i = 2; taken.has(candidate.toLowerCase()); i++) candidate = `${name} ${i}`;
  return candidate;
}

export async function addProperty(
  userId: string,
  databaseId: string,
  input: { name: string; type: PropertyType; options?: string[]; relation?: RelationInput },
) {
  const database = await requireDatabase(userId, databaseId, "edit");
  if (!PROPERTY_TYPES.includes(input.type)) {
    throw new PropertyValueError(`Unsupported type "${input.type}"`, "unsupportedType", { type: String(input.type) });
  }
  let target: typeof database | null = null;
  if (input.type === "relation") {
    const invalidTarget = () =>
      new PropertyValueError("A relation must point to a database in the same workspace", "invalidRelationTarget");
    if (!input.relation?.databaseId) throw invalidTarget();
    target =
      input.relation.databaseId === databaseId
        ? database
        : // A two-way relation also adds a property to the target, so it needs edit access there.
          await requireDatabase(userId, input.relation.databaseId, input.relation.twoWay ? "edit" : "view").catch(() => null);
    if (!target || target.workspaceId !== database.workspaceId || target.archivedAt) throw invalidTarget();
  }
  const options: PropertyOptions =
    input.type === "select" || input.type === "multi_select"
      ? { options: (input.options ?? []).map((name, i) => makeOption(name, i)) }
      : target
        ? { relation: { databaseId: target.id } }
        : {};
  const created = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(databaseProperty)
      .values({
        databaseId,
        name: input.name.trim() || "Property",
        type: input.type,
        options,
        position: await nextPropertyPosition(databaseId),
      })
      .returning();
    if (!target || !input.relation?.twoWay) return created;
    const pairedName = await uniquePropertyName(
      target.id,
      input.relation.pairedName?.trim() || database.title.trim() || "Related",
    );
    const [paired] = await tx
      .insert(databaseProperty)
      .values({
        databaseId: target.id,
        name: pairedName,
        type: "relation",
        options: { relation: { databaseId, pairedPropertyId: created.id } },
        position: await nextPropertyPosition(target.id),
      })
      .returning();
    const relation: RelationConfig = { databaseId: target.id, pairedPropertyId: paired.id };
    const [linked] = await tx
      .update(databaseProperty)
      .set({ options: { relation } })
      .where(eq(databaseProperty.id, created.id))
      .returning();
    return linked;
  });
  notifySchema(databaseId);
  if (target && target.id !== databaseId) notifySchema(target.id);
  return created;
}

export function makeOption(name: string, index = 0): SelectOption {
  return { id: crypto.randomUUID(), name: name.trim(), color: SELECT_COLORS[index % SELECT_COLORS.length] };
}

/** A property the user may change (every caller edits the schema). */
async function requireProperty(userId: string, propertyId: string) {
  const [prop] = await db.select().from(databaseProperty).where(eq(databaseProperty.id, propertyId));
  if (!prop) throw new AccessError();
  await requireDatabase(userId, prop.databaseId, "edit");
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
  if (prop.type !== "select" && prop.type !== "multi_select") {
    throw withCode(new Error("Not a select property"), "notASelectProperty");
  }
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
  const pairedId = prop.type === "relation" ? prop.options.relation?.pairedPropertyId : null;
  const [paired] = pairedId ? await db.select().from(databaseProperty).where(eq(databaseProperty.id, pairedId)) : [];
  await db.transaction(async (tx) => {
    await tx.delete(databaseProperty).where(eq(databaseProperty.id, propertyId));
    // The other side of a two-way relation stays, as a one-way relation with its values intact.
    if (paired?.options.relation) {
      await tx
        .update(databaseProperty)
        .set({ options: { ...paired.options, relation: { ...paired.options.relation, pairedPropertyId: null } } })
        .where(eq(databaseProperty.id, paired.id));
    }
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
            dateBy: c.dateBy === propertyId ? undefined : c.dateBy,
            sorts: c.sorts?.filter((s) => s.propertyId !== propertyId),
            filters: c.filters?.filter((f) => f.propertyId !== propertyId),
            hidden: c.hidden?.filter((h) => h !== propertyId),
            shown: c.shown?.filter((h) => h !== propertyId),
          },
        })
        .where(eq(databaseView.id, view.id));
    }
  });
  notifySchema(prop.databaseId);
  if (paired && paired.databaseId !== prop.databaseId) notifySchema(paired.databaseId);
}

export async function addView(userId: string, databaseId: string, input: { name: string; type: ViewType }) {
  const database = await requireDatabase(userId, databaseId, "edit");
  const props = await getProperties(databaseId);
  const config: ViewConfig = {};
  if (input.type === "board") config.groupBy = props.find((p) => p.type === "select")?.id;
  if (input.type === "calendar") {
    config.dateBy = props.find((p) => p.type === "date")?.id;
    // Calendar entries are small: show only titles until the user picks properties to show.
    config.hidden = props.map((p) => p.id);
  }
  const [{ max }] = await db
    .select({ max: sql<number | null>`max(${databaseView.position})` })
    .from(databaseView)
    .where(eq(databaseView.databaseId, databaseId));
  const [created] = await db
    .insert(databaseView)
    .values({
      databaseId,
      name: input.name.trim() || { table: "Table", board: "Board", calendar: "Calendar" }[input.type],
      type: input.type,
      config,
      position: (Number(max) || 0) + 1,
    })
    .returning();
  notifySchema(databaseId);
  notifyTree(database.workspaceId);
  return created;
}

/** A view the user may change (every caller edits it). */
async function requireView(userId: string, viewId: string) {
  const [view] = await db.select().from(databaseView).where(eq(databaseView.id, viewId));
  if (!view) throw new AccessError();
  const database = await requireDatabase(userId, view.databaseId, "edit");
  return { ...view, workspaceId: database.workspaceId };
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
  if (patch.name !== undefined) notifyTree(view.workspaceId);
}

export async function deleteView(userId: string, viewId: string) {
  const view = await requireView(userId, viewId);
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(databaseView)
    .where(eq(databaseView.databaseId, view.databaseId));
  if (count <= 1) throw withCode(new Error("A database needs at least one view"), "lastView");
  await db.delete(databaseView).where(eq(databaseView.id, viewId));
  notifySchema(view.databaseId);
  notifyTree(view.workspaceId);
}

/** Reorders a row (board drag) and optionally changes its group value in one step. */
export async function moveRow(
  userId: string,
  rowId: string,
  { position, groupBy, groupValue }: { position?: number; groupBy?: string; groupValue?: string | null },
) {
  const row = await requirePageAccess(userId, rowId, "edit");
  if (!row.parentId) throw withCode(new Error("Page is not a database row"), "notADatabaseRow");
  await requireDatabase(userId, row.parentId, "view");
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
    relations: await getRelationTargets(userId, properties),
  };
}

export type RelationTargetRow = { id: string; title: string; icon: string | null };
export type RelationTarget = {
  /** Null when the related database was deleted or is in the trash. */
  database: { id: string; title: string; icon: string | null } | null;
  /** Name of the paired property on the related database, for two-way relations. */
  pairedName: string | null;
  /** Live rows of the related database, in manual order: link candidates and display titles. */
  rows: RelationTargetRow[];
};

/**
 * The related database and its rows for every relation property, keyed by property id, limited
 * to what the user can see: access to the source database doesn't cover the related one.
 */
export async function getRelationTargets(
  userId: string,
  properties: DatabaseProperty[],
): Promise<Record<string, RelationTarget>> {
  const targetIds = [
    ...new Set(properties.flatMap((p) => (p.type === "relation" && p.options.relation ? [p.options.relation.databaseId] : []))),
  ];
  if (!targetIds.length) return {};
  const pairedIds = properties.flatMap((p) => (p.options.relation?.pairedPropertyId ? [p.options.relation.pairedPropertyId] : []));
  const [databases, rows, paired] = await Promise.all([
    db
      .select({ id: page.id, title: page.title, icon: page.icon })
      .from(page)
      .where(and(inArray(page.id, targetIds), eq(page.kind, "database"), isNull(page.archivedAt), pageVisibleTo(userId))),
    db
      .select({ id: page.id, title: page.title, icon: page.icon, parentId: page.parentId })
      .from(page)
      .where(and(inArray(page.parentId, targetIds), isNull(page.archivedAt), pageVisibleTo(userId)))
      .orderBy(asc(page.position), asc(page.createdAt)),
    pairedIds.length
      ? db
          .select({ id: databaseProperty.id, name: databaseProperty.name })
          .from(databaseProperty)
          .where(inArray(databaseProperty.id, pairedIds))
      : Promise.resolve([]),
  ]);
  const out: Record<string, RelationTarget> = {};
  for (const prop of properties) {
    const targetId = prop.type === "relation" ? prop.options.relation?.databaseId : undefined;
    if (!targetId) continue;
    const database = databases.find((d) => d.id === targetId) ?? null;
    const pairedId = prop.options.relation?.pairedPropertyId;
    out[prop.id] = {
      database,
      pairedName: (pairedId && paired.find((p) => p.id === pairedId)?.name) || null,
      rows: database
        ? rows.filter((r) => r.parentId === targetId).map(({ id, title, icon }) => ({ id, title, icon }))
        : [],
    };
  }
  return out;
}

/** Live databases of a workspace, for choosing the target of a relation. */
export async function listWorkspaceDatabases(userId: string, workspaceId: string) {
  await requireMembership(userId, workspaceId);
  return db
    .select({ id: page.id, title: page.title, icon: page.icon })
    .from(page)
    .where(and(eq(page.workspaceId, workspaceId), eq(page.kind, "database"), isNull(page.archivedAt), pageVisibleTo(userId)))
    .orderBy(asc(page.title));
}

/** A single row with its database schema, for the property panel on a row page. */
export async function getRow(userId: string, rowId: string) {
  const row = await requirePageAccess(userId, rowId, "view");
  if (!row.parentId) throw withCode(new Error("Page is not a database row"), "notADatabaseRow");
  const database = await requireDatabase(userId, row.parentId, "view");
  const properties = await getProperties(row.parentId);
  return {
    databaseId: row.parentId,
    databaseTitle: database.title,
    row: { id: row.id, title: row.title, properties: row.properties },
    properties,
    relations: await getRelationTargets(userId, properties),
  };
}
