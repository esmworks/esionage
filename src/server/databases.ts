import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  databaseProperty,
  databaseView,
  page,
  PROPERTY_TYPES,
  user,
  type PropertyOptions,
  type PropertyType,
  type RelationConfig,
  type SelectOption,
  type ViewConfig,
  type ViewType,
} from "@/db/schema";
import { COLLAB_FRAGMENT } from "@/lib/collab-constants";
import { firstImageInYdoc, PG_MARKDOWN_IMAGE_PATTERN } from "@/lib/cover";
import { filterConfigError, filterRules, mapFilterRules } from "@/lib/filters";
import { chartGroupProperty } from "@/lib/chart";
import { DEFAULT_VIEW_NAMES, galleryCover, isViewType, layoutConfigError } from "@/lib/views";
import { holdsOptions, holdsPeople, isComputed, PERSON_ME, type StatusGroup } from "@/lib/property-types";
import { moveGroupValue } from "@/lib/grouping";
import {
  applyView,
  computedValues,
  isGroupable,
  makeStatusOptions,
  normalizeValue,
  PropertyValueError,
  SELECT_COLORS,
  sortStatusOptions,
  statusColor,
  type DatabaseErrorCode,
} from "@/lib/properties";
import {
  AccessError,
  accessRank,
  getMembership,
  hasLevel,
  isGuest,
  levelFromRank,
  pageVisibleTo,
  requireMembership,
  requirePageAccess,
  type RequiredLevel,
} from "@/server/access";
import { scheduleAssignmentEmails } from "@/server/assignments";
import { recordAssignments } from "@/server/notifications";
import { getCollab } from "@/server/collab/bridge";
import { workspacePeople, type WorkspacePerson } from "@/server/workspaces";

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
 * Rows as read from the database, with values Esionage fills in (who created and last edited
 * them, and when) merged in.
 */
function withComputed<T extends StoredRow>(
  rows: T[],
  properties: { id: string; type: PropertyType }[],
): (Omit<T, "createdBy" | "updatedBy"> & { properties: Record<string, unknown> })[] {
  if (!properties.some((p) => isComputed(p.type))) return rows.map(({ createdBy: _, updatedBy: __, ...row }) => row);
  return rows.map(({ createdBy, updatedBy, ...row }) => ({
    ...row,
    properties: { ...row.properties, ...computedValues(properties, { createdBy, updatedBy, ...row }) },
  }));
}

type StoredRow = {
  properties: Record<string, unknown>;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Sorting by a people property orders rows by names, so the view needs to know them. */
async function peopleForSorts(userId: string, properties: DatabaseProperty[], config: ViewConfig) {
  const sorted = (config.sorts ?? []).some((s) => properties.some((p) => p.id === s.propertyId && holdsPeople(p.type)));
  return sorted ? getPeople(userId, properties) : [];
}

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

/**
 * A locked database keeps its properties and views: they can't be added, renamed or removed until
 * someone with full access unlocks it. Rows, cell values and view filters stay editable.
 */
function assertUnlocked(database: { lockedAt: Date | null }) {
  if (database.lockedAt) throw withCode(new Error("The database is locked"), "databaseLocked");
}

/** Locks or unlocks a database's schema. Needs full access. */
export async function setDatabaseLocked(userId: string, databaseId: string, locked: boolean) {
  await requireDatabase(userId, databaseId, "full");
  await db
    .update(page)
    .set({ lockedAt: locked ? new Date() : null, updatedBy: userId })
    .where(eq(page.id, databaseId));
  notifySchema(databaseId);
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
  // Rows inherit their database's access; rows restricted on their own are left out.
  await requireDatabase(userId, databaseId, "view");
  const [rows, properties] = await Promise.all([
    db
      .select({
        id: page.id,
        title: page.title,
        icon: page.icon,
        properties: page.properties,
        createdBy: page.createdBy,
        updatedBy: page.updatedBy,
        createdAt: page.createdAt,
        updatedAt: page.updatedAt,
      })
      .from(page)
      .where(and(eq(page.parentId, databaseId), isNull(page.archivedAt), pageVisibleTo(userId)))
      .orderBy(asc(page.position), asc(page.createdAt)),
    getProperties(databaseId),
  ]);
  const people = await peopleForSorts(userId, properties, config);
  return applyView<DatabaseRow>(withComputed(rows, properties), config, properties, { viewerId: userId, people });
}

/**
 * Validates row values keyed by property id or (case-insensitive) name and returns them keyed
 * by id. Unknown keys are rejected so agents learn the schema instead of silently losing data.
 */
export async function normalizeRowProperties(
  userId: string,
  databaseId: string,
  input: Record<string, unknown>,
  /** The row's stored values, when editing an existing row. */
  existing: Record<string, unknown> = {},
) {
  const props = await getProperties(databaseId);
  const out: Record<string, unknown> = {};
  let people: Promise<WorkspacePerson[]> | undefined;
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
    if (prop.type === "relation" && normalized) {
      out[prop.id] = await resolveRelationValue(userId, prop, normalized as string[], asIds(existing[prop.id]));
    } else if (prop.type === "person" && normalized) {
      people ??= workspacePeopleOf(databaseId);
      out[prop.id] = resolvePersonValue(userId, prop, normalized as string[], asIds(existing[prop.id]), await people);
    } else out[prop.id] = normalized;
  }
  return out;
}

/** Everyone in the workspace a database belongs to, guests included. */
async function workspacePeopleOf(databaseId: string): Promise<WorkspacePerson[]> {
  const [database] = await db.select({ workspaceId: page.workspaceId }).from(page).where(eq(page.id, databaseId));
  return database ? workspacePeople(database.workspaceId) : [];
}

/**
 * Maps person input to user ids of people in the workspace. Each entry is a user id, "me", or,
 * for agents, an email or the exact name of someone in the workspace. Ids the value already
 * holds are kept after their person left the workspace, so a former assignee never blocks
 * editing the rest of the cell. Guests can't see who is in the workspace, so they can't look
 * people up by email or name either.
 */
function resolvePersonValue(
  userId: string,
  prop: DatabaseProperty,
  input: string[],
  existing: string[],
  people: WorkspacePerson[],
) {
  const actor = people.find((p) => p.id === userId);
  const lookup = actor && actor.role !== "guest";
  const out: string[] = [];
  for (const value of input) {
    let id: string | undefined;
    if (value.toLowerCase() === PERSON_ME && actor) id = userId;
    else if (people.some((p) => p.id === value) || existing.includes(value)) id = value;
    else if (lookup) {
      const needle = value.trim().toLowerCase();
      const byEmail = people.find((p) => p.email.toLowerCase() === needle);
      const byName = people.filter((p) => p.name.trim().toLowerCase() === needle);
      if (!byEmail && byName.length > 1) {
        throw new PropertyValueError(
          `"${value}" matches ${byName.length} people in the workspace; pass an email or user id instead`,
          "invalidPerson",
          { property: prop.name },
        );
      }
      id = byEmail?.id ?? byName[0]?.id;
    }
    if (!id) {
      throw new PropertyValueError(`"${value}" is not a person in this workspace`, "invalidPerson", {
        property: prop.name,
      });
    }
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Maps relation input to row ids of the related database. Each entry is a row id (trashed rows
 * included, so existing links survive an edit) or, for agents, the exact title of a live row.
 * Ids the row already links to are kept when the user can't see them, and dropped when they are
 * no longer rows of the related database (deleted for good or moved out), so a stale link never
 * blocks editing the rest of the cell.
 */
async function resolveRelationValue(userId: string, prop: DatabaseProperty, input: string[], existing: string[] = []) {
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
  const unseen = existing.filter((id) => !ids.has(id) && input.includes(id));
  const hidden = new Set(
    unseen.length
      ? (
          await db
            .select({ id: page.id })
            .from(page)
            .where(and(eq(page.parentId, targetId), inArray(page.id, unseen)))
        ).map((r) => r.id)
      : [],
  );
  const out: string[] = [];
  for (const value of input) {
    if (unseen.includes(value)) {
      if (hidden.has(value) && !out.includes(value)) out.push(value);
      continue;
    }
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
  await syncPairedRelationsMany(databaseId, [{ rowId, before, after }]);
}

/** `syncPairedRelations` for several rows of one database; each related database is notified once. */
export async function syncPairedRelationsMany(
  databaseId: string,
  changes: { rowId: string; before: Record<string, unknown>; after: Record<string, unknown> }[],
) {
  const props = (await getProperties(databaseId)).filter((p) => p.type === "relation" && p.options.relation?.pairedPropertyId);
  if (!props.length) return;
  const touched = new Set<string>();
  for (const { rowId, before, after } of changes) {
    for (const prop of props) {
      const relation = prop.options.relation!;
      const was = asIds(before[prop.id]);
      const now = asIds(after[prop.id]);
      const added = now.filter((id) => !was.includes(id));
      const removed = was.filter((id) => !now.includes(id));
      if (!added.length && !removed.length) continue;
      const key = relation.pairedPropertyId!;
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
      touched.add(relation.databaseId);
    }
  }
  for (const id of touched) notifyRows(id);
}

export async function updateRowProperties(userId: string, rowId: string, patch: Record<string, unknown>) {
  const row = await requirePageAccess(userId, rowId, "edit");
  if (!row.parentId) throw withCode(new Error("Page is not a database row"), "notADatabaseRow");
  await requireDatabase(userId, row.parentId, "view");
  const normalized = await normalizeRowProperties(userId, row.parentId, patch, row.properties);
  const next = { ...row.properties };
  for (const [id, value] of Object.entries(normalized)) {
    if (value === null) delete next[id];
    else next[id] = value;
  }
  await db.update(page).set({ properties: next, updatedBy: userId }).where(eq(page.id, rowId));
  await syncPairedRelations(rowId, row.parentId, row.properties, next);
  await announceAssignments(userId, row.parentId, [{ rowId, before: row.properties, after: next }]);
  notifyRows(row.parentId);
  return next;
}

/** Bulk row actions take at most this many rows per call. */
export const MAX_BULK_ROWS = 1000;

/** Guards a bulk call's size and drops repeated ids, keeping the given order. */
export function bulkRowIds(rowIds: string[]) {
  const unique = [...new Set(rowIds)];
  if (unique.length > MAX_BULK_ROWS) {
    throw new PropertyValueError(`At most ${MAX_BULK_ROWS} rows can be changed at once`, "tooManyRows", {
      max: String(MAX_BULK_ROWS),
    });
  }
  return unique;
}

/**
 * Which of `rowIds` are rows of the database the user may act on at `needed` level, in one query.
 * Everything else (rows they can't see or may only view, rows in the trash, ids of other pages or
 * of nothing) comes back as `skipped`, without saying why, so the call never reveals what exists.
 */
export async function rowsWithAccess(userId: string, databaseId: string, rowIds: string[], needed: RequiredLevel) {
  const found = rowIds.length
    ? await db
        .select({
          id: page.id,
          properties: page.properties,
          archivedAt: page.archivedAt,
          level: accessRank(userId, sql`${page.id}`),
        })
        .from(page)
        .where(and(inArray(page.id, rowIds), eq(page.parentId, databaseId)))
    : [];
  const allowed = new Map(
    found.filter((r) => !r.archivedAt && hasLevel(levelFromRank(r.level), needed)).map((r) => [r.id, r] as const),
  );
  return {
    rows: rowIds.flatMap((id) => (allowed.has(id) ? [allowed.get(id)!] : [])),
    skipped: rowIds.filter((id) => !allowed.has(id)),
  };
}

/** What a bulk row action did: the rows it changed and the ones it left alone (see rowsWithAccess). */
export type BulkResult = { done: string[]; skipped: string[] };

/**
 * Sets the same property values on several rows of a database ("edit property" on a selection).
 * Values are checked once, before anything is written, so a bad value changes nothing. Access is
 * checked per row: rows the user may edit are updated in one statement, the rest are skipped and
 * returned so the caller can say so (nothing is skipped silently). Links to rows the user can't
 * see can't be set in bulk. Other properties of the rows are left as they are.
 */
export async function updateRowsProperties(
  userId: string,
  databaseId: string,
  rowIds: string[],
  patch: Record<string, unknown>,
): Promise<BulkResult> {
  const ids = bulkRowIds(rowIds);
  await requireDatabase(userId, databaseId, "view");
  const normalized = await normalizeRowProperties(userId, databaseId, patch);
  const { rows, skipped } = await rowsWithAccess(userId, databaseId, ids, "edit");
  if (!rows.length || !Object.keys(normalized).length) return { done: [], skipped };

  const set = Object.fromEntries(Object.entries(normalized).filter(([, v]) => v !== null));
  const cleared = Object.keys(normalized).filter((k) => normalized[k] === null);
  // Merged in SQL, so a concurrent edit of another property of the same row isn't overwritten.
  const minus = cleared.length
    ? sql` - ARRAY[${sql.join(
        cleared.map((k) => sql`${k}::text`),
        sql`, `,
      )}]::text[]`
    : sql``;
  await db.execute(sql`
    update ${page} set
      properties = (properties || ${JSON.stringify(set)}::jsonb)${minus},
      updated_by = ${userId},
      updated_at = now()
    where ${inArray(page.id, rows.map((r) => r.id))}
  `);

  const changes = rows.map((row) => {
    const after: Record<string, unknown> = { ...row.properties, ...set };
    for (const k of cleared) delete after[k];
    return { rowId: row.id, before: row.properties, after };
  });
  await syncPairedRelationsMany(databaseId, changes);
  await announceAssignments(userId, databaseId, changes);
  notifyRows(databaseId);
  return { done: rows.map((r) => r.id), skipped };
}

/**
 * Tells the people these row writes newly assign: an inbox notification right away and an email
 * after a short delay (see server/notifications and server/assignments).
 */
export async function announceAssignments(
  actorId: string,
  databaseId: string,
  changes: { rowId: string; before: Record<string, unknown>; after: Record<string, unknown> }[],
) {
  const personProps = (await getProperties(databaseId)).filter((p) => p.type === "person");
  if (!personProps.length) return;
  const [database] = await db.select({ workspaceId: page.workspaceId }).from(page).where(eq(page.id, databaseId));
  if (database) await recordAssignments(actorId, database.workspaceId, personProps, changes);
  await scheduleAssignmentEmails(actorId, personProps, changes);
}

export type NewRow = { title: string; properties?: Record<string, unknown> };

/**
 * Adds several rows to a database at once, in the given order after the existing rows. Every
 * row's values are checked before anything is written and the rows go in with one insert, so a
 * bad value leaves the database unchanged and a retried import doesn't leave duplicates behind.
 */
export async function createRows(userId: string, databaseId: string, rows: NewRow[]) {
  const database = await requireDatabase(userId, databaseId, "edit");
  if (database.archivedAt) throw withCode(new AccessError("Parent page is in the trash"), "parentInTrash");
  if (!rows.length) return [];

  const values: Record<string, unknown>[] = [];
  for (const [i, row] of rows.entries()) {
    try {
      values.push(await normalizeRowProperties(userId, databaseId, row.properties ?? {}));
    } catch (error) {
      if (error instanceof PropertyValueError) error.message = `Row ${i + 1} ("${row.title.trim()}"): ${error.message}`;
      throw error;
    }
  }

  const [{ max }] = await db
    .select({ max: sql<number | null>`max(${page.position})` })
    .from(page)
    .where(eq(page.parentId, databaseId));
  const start = (Number(max) || 0) + 1;
  const created = rows.map((row, i) => ({
    id: crypto.randomUUID(),
    workspaceId: database.workspaceId,
    parentId: databaseId,
    kind: "page" as const,
    title: row.title.trim(),
    properties: values[i],
    position: start + i,
    createdBy: userId,
    updatedBy: userId,
  }));
  await db.insert(page).values(created);

  for (const row of created) await syncPairedRelations(row.id, databaseId, {}, row.properties);
  await announceAssignments(
    userId,
    databaseId,
    created.map((row) => ({ rowId: row.id, before: {}, after: row.properties })),
  );
  notifyTree(database.workspaceId);
  notifyRows(databaseId);
  return created.map(({ id, title }) => ({ id, title }));
}

export type RelationInput = {
  /** The database whose rows this property links to (same workspace; may be this database). */
  databaseId: string;
  /** Also add a property on the related database that shows the links back. */
  twoWay?: boolean;
  /** Name of that paired property; defaults to this database's title. */
  pairedName?: string;
};

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

// Take the transaction when called inside one: the outer pool can't see its uncommitted inserts.
async function nextPropertyPosition(databaseId: string, exec: Executor = db) {
  const [{ max }] = await exec
    .select({ max: sql<number | null>`max(${databaseProperty.position})` })
    .from(databaseProperty)
    .where(eq(databaseProperty.databaseId, databaseId));
  return (Number(max) || 0) + 1;
}

/** `name`, or `name 2`, `name 3`… so it doesn't clash with a property of the database. */
async function uniquePropertyName(databaseId: string, name: string, exec: Executor = db) {
  const names = await exec
    .select({ name: databaseProperty.name })
    .from(databaseProperty)
    .where(eq(databaseProperty.databaseId, databaseId));
  const taken = new Set(names.map((p) => p.name.trim().toLowerCase()));
  taken.add("title");
  let candidate = name;
  for (let i = 2; taken.has(candidate.toLowerCase()); i++) candidate = `${name} ${i}`;
  return candidate;
}

/**
 * Calendar entries show only the properties the user picked (a new calendar view hides every
 * property), so a property added later starts hidden there too.
 */
async function hideInCalendars(exec: Executor, databaseId: string, propertyId: string) {
  // Explicit casts: inside set() drizzle would send the parameters as jsonb, like the column.
  const hidden = sql`coalesce(${databaseView.config} -> 'hidden', '[]'::jsonb)`;
  await exec
    .update(databaseView)
    .set({ config: sql`jsonb_set(${databaseView.config}, '{hidden}', ${hidden} || to_jsonb(${propertyId}::text))` })
    .where(and(eq(databaseView.databaseId, databaseId), eq(databaseView.type, "calendar")));
}

export async function addProperty(
  userId: string,
  databaseId: string,
  input: { name: string; type: PropertyType; options?: OptionInput[]; relation?: RelationInput },
) {
  const database = await requireDatabase(userId, databaseId, "edit");
  assertUnlocked(database);
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
        : await requireDatabase(userId, input.relation.databaseId, "view").catch(() => null);
    if (!target || target.workspaceId !== database.workspaceId || target.archivedAt) throw invalidTarget();
    // A two-way relation also adds a property to the target, so it needs edit access there.
    if (input.relation.twoWay && target.id !== databaseId) {
      const editable = await requireDatabase(userId, target.id, "edit").then(
        () => true,
        () => false,
      );
      if (!editable) {
        throw new PropertyValueError("Two-way relations need edit access to the related database", "relationTargetReadOnly");
      }
    }
  }
  const options: PropertyOptions =
    input.type === "select" || input.type === "multi_select"
      ? { options: (input.options ?? []).map((o, i) => makeOption(typeof o === "string" ? o : o.name, i)) }
      : input.type === "status"
        ? { options: makeStatusOptions(input.options) }
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
        position: await nextPropertyPosition(databaseId, tx),
      })
      .returning();
    await hideInCalendars(tx, databaseId, created.id);
    if (!target || !input.relation?.twoWay) return created;
    const pairedName = await uniquePropertyName(
      target.id,
      input.relation.pairedName?.trim() || database.title.trim() || "Related",
      tx,
    );
    const [paired] = await tx
      .insert(databaseProperty)
      .values({
        databaseId: target.id,
        name: pairedName,
        type: "relation",
        options: { relation: { databaseId, pairedPropertyId: created.id } },
        position: await nextPropertyPosition(target.id, tx),
      })
      .returning();
    await hideInCalendars(tx, target.id, paired.id);
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

/**
 * An option to create: its name, or for status properties its name and group (options given by
 * name only are spread over the groups, see makeStatusOptions).
 */
export type OptionInput = string | { name: string; group?: StatusGroup };

/**
 * For row writes that follow a schema change (a deleted property or option): the rows weren't
 * edited, so their "last edited" time stays.
 */
const KEEP_EDIT_TIME = { updatedAt: sql<Date>`${page.updatedAt}` };

export function makeOption(name: string, index = 0): SelectOption {
  return { id: crypto.randomUUID(), name: name.trim(), color: SELECT_COLORS[index % SELECT_COLORS.length] };
}

/**
 * A property the user may change. Every caller edits the schema, which a lock forbids, except
 * adding an option while typing a new tag into a cell (`cellEdit`).
 */
async function requireProperty(userId: string, propertyId: string, { cellEdit = false } = {}) {
  const [prop] = await db.select().from(databaseProperty).where(eq(databaseProperty.id, propertyId));
  if (!prop) throw new AccessError();
  const database = await requireDatabase(userId, prop.databaseId, "edit");
  if (!cellEdit) assertUnlocked(database);
  return prop;
}

export async function updateProperty(
  userId: string,
  propertyId: string,
  patch: { name?: string; options?: SelectOption[]; position?: number },
) {
  const prop = await requireProperty(userId, propertyId);
  // Status options are kept in group order with a valid group each.
  if (patch.options && prop.type === "status") patch = { ...patch, options: sortStatusOptions(patch.options) };
  // Rows must not keep ids of deleted options: they'd show as empty yet fail validation on the next edit.
  const removed = patch.options
    ? (prop.options.options ?? []).filter((o) => !patch.options!.some((n) => n.id === o.id)).map((o) => o.id)
    : [];
  await db.transaction(async (tx) => {
    await tx
      .update(databaseProperty)
      .set({
        ...(patch.name !== undefined ? { name: patch.name.trim() || prop.name } : {}),
        ...(patch.options !== undefined ? { options: { ...prop.options, options: patch.options } } : {}),
        ...(patch.position !== undefined ? { position: patch.position } : {}),
      })
      .where(eq(databaseProperty.id, propertyId));
    if (!removed.length) return;
    const ids = sql`${sql.raw("ARRAY[")}${sql.join(
      removed.map((id) => sql`${id}::text`),
      sql`, `,
    )}${sql.raw("]::text[]")}`;
    // Explicit casts: inside set() drizzle would send the parameters as jsonb, like the column.
    const current = sql`(${page.properties} -> ${propertyId}::text)`;
    if (prop.type === "select" || prop.type === "status") {
      await tx
        .update(page)
        .set({ properties: sql`${page.properties} - ${propertyId}::text`, ...KEEP_EDIT_TIME })
        .where(and(eq(page.parentId, prop.databaseId), sql`${page.properties} ->> ${propertyId}::text = any(${ids})`));
    } else if (prop.type === "multi_select") {
      await tx
        .update(page)
        .set({
          properties: sql`case when (${current} - ${ids}) = '[]'::jsonb then ${page.properties} - ${propertyId}::text
            else jsonb_set(${page.properties}, ${`{${propertyId}}`}::text[], ${current} - ${ids}) end`,
          ...KEEP_EDIT_TIME,
        })
        .where(and(eq(page.parentId, prop.databaseId), sql`${current} ?| ${ids}`));
    }
  });
  notifySchema(prop.databaseId);
  if (removed.length) notifyRows(prop.databaseId);
}

/** Adds a select option by name if missing and returns it (used when typing a new tag). */
export async function ensureOption(userId: string, propertyId: string, name: string) {
  const prop = await requireProperty(userId, propertyId, { cellEdit: true });
  if (!holdsOptions(prop.type)) {
    throw withCode(new Error("Not a select property"), "notASelectProperty");
  }
  const options = prop.options.options ?? [];
  const existing = options.find((o) => o.name.toLowerCase() === name.trim().toLowerCase());
  if (existing) return existing;
  // A status option added by name (a new board column) starts out as to do.
  const option: SelectOption =
    prop.type === "status"
      ? { ...makeOption(name), color: statusColor("todo"), group: "todo" }
      : makeOption(name, options.length);
  const next = [...options, option];
  await db
    .update(databaseProperty)
    .set({ options: { ...prop.options, options: prop.type === "status" ? sortStatusOptions(next) : next } })
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
      .set({ properties: sql`${page.properties} - ${propertyId}`, ...KEEP_EDIT_TIME })
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
            endDateBy: c.endDateBy === propertyId ? undefined : c.endDateBy,
            stackBy: c.stackBy === propertyId ? undefined : c.stackBy,
            chartAggregate: c.chartAggregate?.propertyId === propertyId ? undefined : c.chartAggregate,
            sorts: c.sorts?.filter((s) => s.propertyId !== propertyId),
            filters: c.filters && mapFilterRules(c.filters, (f) => (f.propertyId === propertyId ? null : f)),
            hidden: c.hidden?.filter((h) => h !== propertyId),
            shown: c.shown?.filter((h) => h !== propertyId),
            calculations: c.calculations && Object.fromEntries(Object.entries(c.calculations).filter(([k]) => k !== propertyId)),
          },
        })
        .where(eq(databaseView.id, view.id));
    }
  });
  notifySchema(prop.databaseId);
  if (paired && paired.databaseId !== prop.databaseId) notifySchema(paired.databaseId);
}

export async function addView(userId: string, databaseId: string, input: { name: string; type: ViewType }) {
  if (!isViewType(input.type)) {
    throw new PropertyValueError(`Unsupported view type "${String(input.type)}"`, "unsupportedViewType", {
      type: String(input.type),
    });
  }
  const database = await requireDatabase(userId, databaseId, "edit");
  assertUnlocked(database);
  const props = await getProperties(databaseId);
  const config: ViewConfig = {};
  if (input.type === "board") config.groupBy = props.find((p) => p.type === "select" || p.type === "status")?.id;
  if (input.type === "calendar") {
    config.dateBy = props.find((p) => p.type === "date")?.id;
    // Calendar entries are small: show only titles until the user picks properties to show.
    config.hidden = props.map((p) => p.id);
  }
  // Timelines start without swimlanes and with a week per column; list rows and timeline bars show
  // only titles until the user picks properties (see hiddenByDefault).
  if (input.type === "timeline") config.dateBy = props.find((p) => p.type === "date")?.id;
  // Charts count rows per option of the property a board would group by, in columns.
  if (input.type === "chart") config.groupBy = chartGroupProperty(props, {})?.id;
  const [{ max }] = await db
    .select({ max: sql<number | null>`max(${databaseView.position})` })
    .from(databaseView)
    .where(eq(databaseView.databaseId, databaseId));
  const [created] = await db
    .insert(databaseView)
    .values({
      databaseId,
      name: input.name.trim() || DEFAULT_VIEW_NAMES[input.type],
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
  return { ...view, workspaceId: database.workspaceId, lockedAt: database.lockedAt };
}

export async function updateView(userId: string, viewId: string, patch: { name?: string; config?: ViewConfig }) {
  // Configs come from the client and from MCP; a malformed filter tree would break every viewer.
  const filterError = patch.config && filterConfigError(patch.config);
  if (filterError) throw new PropertyValueError(filterError, "invalidFilter");
  const layoutError = patch.config && layoutConfigError(patch.config);
  if (layoutError) throw new PropertyValueError(layoutError, "invalidViewConfig");
  const view = await requireView(userId, viewId);
  // Filters, sorts and layout stay adjustable on a locked database; renaming doesn't.
  if (patch.name !== undefined) assertUnlocked(view);
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
  assertUnlocked(view);
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(databaseView)
    .where(eq(databaseView.databaseId, view.databaseId));
  if (count <= 1) throw withCode(new Error("A database needs at least one view"), "lastView");
  await db.delete(databaseView).where(eq(databaseView.id, viewId));
  notifySchema(view.databaseId);
  notifyTree(view.workspaceId);
}

/**
 * Reorders a row (board drag) and optionally moves it to another group in one step. `groupValue`
 * is the target group (see groupTarget in lib/grouping): an option, person or related row id,
 * "true" / "false" for checkboxes, a day for dates, null for no value. For list values
 * (multi-select, people, relations) `groupFrom` is the group the card left: `groupValue` takes
 * its place and the rest stays (see moveGroupValue). The result is validated like any edit.
 */
export async function moveRow(
  userId: string,
  rowId: string,
  {
    position,
    groupBy,
    groupValue,
    groupFrom,
  }: { position?: number; groupBy?: string; groupValue?: string | null; groupFrom?: string | null },
) {
  const row = await requirePageAccess(userId, rowId, "edit");
  if (!row.parentId) throw withCode(new Error("Page is not a database row"), "notADatabaseRow");
  await requireDatabase(userId, row.parentId, "view");
  const properties = { ...row.properties };
  let type: PropertyType | undefined;
  if (groupBy) {
    const prop = (await getProperties(row.parentId)).find((p) => p.id === groupBy);
    // Unknown properties and who created or last edited a row (and when) are refused here.
    if (!prop || isComputed(prop.type)) await normalizeRowProperties(userId, row.parentId, { [groupBy]: groupValue });
    if (!prop || !isGroupable(prop.type)) {
      throw new PropertyValueError(`Rows can't be grouped by a ${prop?.type} property`, "unsupportedType", {
        type: String(prop?.type),
      });
    }
    type = prop.type;
    const next = moveGroupValue(prop, properties[groupBy], groupFrom, groupValue);
    const normalized = await normalizeRowProperties(userId, row.parentId, { [groupBy]: next }, row.properties);
    const value = normalized[groupBy];
    if (value === null || value === undefined || (Array.isArray(value) && !value.length)) delete properties[groupBy];
    else properties[groupBy] = value;
  }
  await db
    .update(page)
    .set({ properties, ...(position !== undefined ? { position } : {}), updatedBy: userId })
    .where(eq(page.id, rowId));
  if (type === "relation") await syncPairedRelations(rowId, row.parentId, row.properties, properties);
  if (type === "person") await announceAssignments(userId, row.parentId, [{ rowId, before: row.properties, after: properties }]);
  notifyRows(row.parentId);
}

export type DatabaseRowWithPosition = DatabaseRow & {
  position: number;
  /** Gallery cover: the first image in the row's body. Only sent while a gallery view shows covers. */
  cover?: string | null;
};

/** First images of row bodies by row id, valid while the row's `updatedAt` stays the same. */
const coverCache = new Map<string, { at: number; url: string | null }>();
const MAX_CACHED_COVERS = 5000;

/**
 * The first image in each row's body, for gallery covers. Only rows whose Markdown mentions an
 * image are read, and from their Yjs state rather than the Markdown, so text that merely looks
 * like image Markdown (in a code block, say) never becomes a cover.
 */
async function rowCovers(rows: { id: string; updatedAt: Date; hasImage?: boolean }[]) {
  const covers = new Map<string, string | null>();
  const missing: string[] = [];
  for (const row of rows) {
    if (!row.hasImage) continue;
    const cached = coverCache.get(row.id);
    if (cached && cached.at === row.updatedAt.getTime()) covers.set(row.id, cached.url);
    else missing.push(row.id);
  }
  if (!missing.length) return covers;
  const docs = await db
    .select({ id: page.id, ydoc: page.ydoc, updatedAt: page.updatedAt })
    .from(page)
    .where(inArray(page.id, missing));
  for (const doc of docs) {
    const url = firstImageInYdoc(doc.ydoc, COLLAB_FRAGMENT);
    covers.set(doc.id, url);
    coverCache.delete(doc.id);
    coverCache.set(doc.id, { at: doc.updatedAt.getTime(), url });
  }
  // Oldest entries first: Maps iterate in insertion order.
  for (const id of coverCache.keys()) {
    if (coverCache.size <= MAX_CACHED_COVERS) break;
    coverCache.delete(id);
  }
  return covers;
}

/**
 * Everything the database UI needs in one round trip. Rows are unfiltered and in manual order
 * (views are applied client-side so switching views and optimistic edits are instant).
 */
export async function getDatabaseSnapshot(userId: string, databaseId: string) {
  const { database, properties, views } = await getDatabase(userId, databaseId);
  const withCovers = views.some((v) => v.type === "gallery" && galleryCover(v.config) === "first_image");
  const stored = await db
    .select({
      id: page.id,
      title: page.title,
      icon: page.icon,
      properties: page.properties,
      createdBy: page.createdBy,
      updatedBy: page.updatedBy,
      position: page.position,
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
      ...(withCovers ? { hasImage: sql<boolean>`${page.contentMarkdown} ~ ${PG_MARKDOWN_IMAGE_PATTERN}` } : {}),
    })
    .from(page)
    .where(
      and(
        eq(page.parentId, databaseId),
        // A trashed database still shows (and exports) the rows that went to the trash with it.
        database.archivedAt ? eq(page.archivedAt, database.archivedAt) : isNull(page.archivedAt),
        pageVisibleTo(userId),
      ),
    )
    .orderBy(asc(page.position), asc(page.createdAt));
  const covers = withCovers ? await rowCovers(stored) : null;
  const rows: DatabaseRowWithPosition[] = withComputed(stored, properties).map(({ hasImage: _, ...row }) =>
    covers ? { ...row, cover: covers.get(row.id) ?? null } : row,
  );
  return {
    database: {
      id: database.id,
      workspaceId: database.workspaceId,
      title: database.title,
      icon: database.icon,
      archived: Boolean(database.archivedAt),
      locked: Boolean(database.lockedAt),
    },
    properties,
    views,
    rows,
    relations: await getRelationTargets(userId, properties),
    people: await getPeople(userId, properties),
    viewerId: userId,
  };
}

export type RelationTargetRow = { id: string; title: string; icon: string | null };
export type RelationTarget = {
  /** Null when the related database was deleted or is in the trash. */
  database: { id: string; title: string; icon: string | null } | null;
  /** Name of the paired property on the related database, for two-way relations; null when hidden. */
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
      // The paired property lives on the related database: named only for those who can see it.
      pairedName: (database && pairedId && paired.find((p) => p.id === pairedId)?.name) || null,
      rows: database
        ? rows.filter((r) => r.parentId === targetId).map(({ id, title, icon }) => ({ id, title, icon }))
        : [],
    };
  }
  return out;
}

/** Someone a person property can show or hold. */
export type PersonRef = {
  id: string;
  name: string;
  /** Null when the viewer may not see it (guests only see names). */
  email: string | null;
  /** False once they left the workspace: still shown where assigned, no longer offered. */
  active: boolean;
};

/**
 * The people person properties of these properties' database can show and offer, sorted by name.
 * Owners and members get everyone in the workspace; guests, who can't see who is in the
 * workspace, get themselves and the people already assigned in rows or views they can see.
 * Former members still assigned somewhere come along as inactive, so their name keeps showing.
 */
export async function getPeople(userId: string, properties: DatabaseProperty[]): Promise<PersonRef[]> {
  const personProps = properties.filter((p) => holdsPeople(p.type));
  if (!personProps.length) return [];
  const databaseId = personProps[0].databaseId;
  const [database] = await db.select({ workspaceId: page.workspaceId }).from(page).where(eq(page.id, databaseId));
  const membership = database && (await getMembership(userId, database.workspaceId));
  if (!membership) return [];
  const [members, rows, views] = await Promise.all([
    workspacePeopleOf(databaseId),
    db
      .select({ properties: page.properties, createdBy: page.createdBy, updatedBy: page.updatedBy })
      .from(page)
      .where(and(eq(page.parentId, databaseId), pageVisibleTo(userId))),
    db.select({ config: databaseView.config }).from(databaseView).where(eq(databaseView.databaseId, databaseId)),
  ]);
  const referenced = new Set<string>();
  for (const { properties: stored, createdBy, updatedBy } of rows) {
    const values = { ...stored, ...computedValues(personProps, { createdBy, updatedBy }) };
    for (const prop of personProps) for (const id of asIds(values[prop.id])) referenced.add(id);
  }
  for (const view of views) {
    for (const rule of filterRules(view.config.filters)) {
      const person = personProps.some((p) => p.id === rule.propertyId);
      if (person && typeof rule.value === "string" && rule.value !== PERSON_ME) referenced.add(rule.value);
    }
  }
  const guest = isGuest(membership.role);
  const out: PersonRef[] = members
    .filter((m) => !guest || m.id === userId || referenced.has(m.id))
    .map((m) => ({ id: m.id, name: m.name, email: guest && m.id !== userId ? null : m.email, active: true }));
  const former = [...referenced].filter((id) => !members.some((m) => m.id === id));
  if (former.length) {
    const users = await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, former));
    out.push(...users.map((u) => ({ id: u.id, name: u.name, email: null, active: false })));
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/** What MCP output needs to name linked rows and people instead of printing ids. */
export type DatabaseLookups = { relations: Record<string, RelationTarget>; people: PersonRef[] };

export async function getLookups(userId: string, properties: DatabaseProperty[]): Promise<DatabaseLookups> {
  const [relations, people] = await Promise.all([getRelationTargets(userId, properties), getPeople(userId, properties)]);
  return { relations, people };
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
    databaseLocked: Boolean(database.lockedAt),
    row: { id: row.id, title: row.title, properties: { ...row.properties, ...computedValues(properties, row) } },
    properties,
    relations: await getRelationTargets(userId, properties),
    people: await getPeople(userId, properties),
    viewerId: userId,
  };
}
