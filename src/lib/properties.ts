import type {
  FilterCombinator,
  FilterEntry,
  FilterOp,
  FilterRule,
  PropertyOptions,
  PropertyType,
  SelectOption,
  SortRule,
  ViewConfig,
  ViewType,
} from "@/db/schema/app";
import {
  compileFilters,
  dayString,
  isDayCount,
  isRelativeDateRange,
  pruneFilters,
  rangeNeedsDays,
  relativeDateRange,
  requiredFilterRules,
  valueDay,
} from "./filters";
import { holdsPeople, PERSON_ME } from "./property-types";

export const SELECT_COLORS = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] as const;

/**
 * Stable codes for user-facing database errors. The English `message` stays the contract for MCP
 * clients; the UI translates by `code` (see `database.errors.*` messages).
 */
export const DATABASE_ERROR_CODES = [
  "invalidUrl",
  "invalidNumber",
  "invalidCheckbox",
  "invalidDate",
  "unknownOption",
  "unknownProperty",
  "unsupportedType",
  "notADatabase",
  "notADatabaseRow",
  "notASelectProperty",
  "lastView",
  "parentInTrash",
  "nestedDatabase",
  "invalidRelation",
  "invalidRelationTarget",
  "invalidPerson",
  "readOnlyProperty",
  "relationTargetReadOnly",
  "databaseLocked",
  "invalidFilter",
  "tooManyRows",
] as const;
export type DatabaseErrorCode = (typeof DATABASE_ERROR_CODES)[number];
export type DatabaseErrorParams = Record<string, string>;

export function isDatabaseErrorCode(code: unknown): code is DatabaseErrorCode {
  return typeof code === "string" && (DATABASE_ERROR_CODES as readonly string[]).includes(code);
}

export class PropertyValueError extends Error {
  code?: DatabaseErrorCode;
  params: DatabaseErrorParams;
  constructor(message: string, code?: DatabaseErrorCode, params: DatabaseErrorParams = {}) {
    super(message);
    this.name = "PropertyValueError";
    this.code = code;
    this.params = params;
  }
}

type PropertyDef = { id: string; name: string; type: PropertyType; options: PropertyOptions };

/** Written by Esionage itself (who created the row), never by users or agents. */
function readOnlyError(prop: PropertyDef) {
  return new PropertyValueError(`"${prop.name}" is set automatically and can't be changed`, "readOnlyProperty", {
    property: prop.name,
  });
}

/**
 * Values Esionage fills in instead of storing: a "created by" property holds the row's creator.
 * Rows read from the database get these merged into their properties.
 */
export function computedValues(props: { id: string; type: PropertyType }[], row: { createdBy: string | null }) {
  const out: Record<string, unknown> = {};
  for (const prop of props) if (prop.type === "created_by") out[prop.id] = row.createdBy ? [row.createdBy] : null;
  return out;
}

function findOption(options: SelectOption[] | undefined, input: unknown): SelectOption | undefined {
  if (typeof input !== "string") return undefined;
  const needle = input.trim().toLowerCase();
  return options?.find((o) => o.id === input || o.name.toLowerCase() === needle);
}

/**
 * Normalizes a user/agent supplied value for storage. Select values are stored as option ids;
 * callers may pass option names (MCP does), which are resolved here. Returns `null` to clear.
 */
export function normalizeValue(prop: PropertyDef, value: unknown): unknown {
  if (prop.type === "created_by") throw readOnlyError(prop);
  if (value === null || value === undefined || value === "") return null;
  switch (prop.type) {
    case "text":
      return String(value);
    case "url": {
      const url = String(value).trim();
      if (!/^https?:\/\//i.test(url) && !/^mailto:/i.test(url)) {
        throw new PropertyValueError(`"${prop.name}" must be an http(s) or mailto URL`, "invalidUrl", {
          property: prop.name,
        });
      }
      return url;
    }
    case "number": {
      const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
      if (!Number.isFinite(n)) throw new PropertyValueError(`"${prop.name}" must be a number`, "invalidNumber", { property: prop.name });
      return n;
    }
    case "checkbox":
      if (typeof value === "boolean") return value;
      if (value === "true" || value === 1) return true;
      if (value === "false" || value === 0) return false;
      throw new PropertyValueError(`"${prop.name}" must be true or false`, "invalidCheckbox", {
        property: prop.name,
      });
    case "date": {
      const s = String(value);
      if (!/^\d{4}-\d{2}-\d{2}/.test(s) || Number.isNaN(Date.parse(s))) {
        throw new PropertyValueError(`"${prop.name}" must be an ISO date (YYYY-MM-DD)`, "invalidDate", {
          property: prop.name,
        });
      }
      return s.slice(0, 10);
    }
    case "select": {
      const option = findOption(prop.options.options, value);
      if (!option) {
        throw new PropertyValueError(`"${value}" is not an option of "${prop.name}"`, "unknownOption", {
          value: String(value),
          property: prop.name,
        });
      }
      return option.id;
    }
    case "relation": {
      // Row ids (or, from MCP, row titles) — resolved and checked against the related database by
      // the server. Order is kept, duplicates dropped.
      const raw = Array.isArray(value) ? value : [value];
      if (raw.some((v) => typeof v !== "string")) {
        throw new PropertyValueError(`"${prop.name}" takes a list of row ids`, "invalidRelation", { property: prop.name });
      }
      const unique = [...new Set((raw as string[]).map((v) => v.trim()).filter(Boolean))];
      return unique.length ? unique : null;
    }
    case "person": {
      // User ids (or, from MCP, emails, names or "me") — resolved and checked against the
      // workspace's people by the server. Order is kept, duplicates dropped.
      const raw = Array.isArray(value) ? value : [value];
      if (raw.some((v) => typeof v !== "string")) {
        throw new PropertyValueError(`"${prop.name}" takes a list of people`, "invalidPerson", { property: prop.name });
      }
      const unique = [...new Set((raw as string[]).map((v) => v.trim()).filter(Boolean))];
      return unique.length ? unique : null;
    }
    case "multi_select": {
      const list = Array.isArray(value) ? value : [value];
      return list.map((v) => {
        const option = findOption(prop.options.options, v);
        if (!option) {
          throw new PropertyValueError(`"${v}" is not an option of "${prop.name}"`, "unknownOption", {
            value: String(v),
            property: prop.name,
          });
        }
        return option.id;
      });
    }
  }
}

/** Human-readable value (option names instead of ids), used by MCP output and markdown export. */
export function displayValue(prop: PropertyDef, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (prop.type === "select") return findOption(prop.options.options, value)?.name ?? null;
  if (prop.type === "multi_select" && Array.isArray(value)) {
    return value.map((v) => findOption(prop.options.options, v)?.name).filter(Boolean);
  }
  return value;
}

export type RowLike = { id: string; title: string; properties: Record<string, unknown>; createdAt: Date; updatedAt: Date };

/** Special property ids understood by filters and sorts in addition to real property ids. */
export const TITLE_KEY = "title";
export const CREATED_KEY = "created_at";
export const UPDATED_KEY = "updated_at";

function rawValue(row: RowLike, key: string): unknown {
  if (key === TITLE_KEY) return row.title;
  if (key === CREATED_KEY) return row.createdAt.toISOString();
  if (key === UPDATED_KEY) return row.updatedAt.toISOString();
  return row.properties[key];
}

function isEmpty(v: unknown) {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0) || v === false;
}

/** The stored value, without ids of select options that no longer exist (they display as empty). */
function liveValue(row: RowLike, key: string, prop: PropertyDef | undefined): unknown {
  const v = rawValue(row, key);
  if (prop?.type !== "select" && prop?.type !== "multi_select") return v;
  const known = (id: unknown) => (prop.options.options ?? []).some((o) => o.id === id);
  if (Array.isArray(v)) return v.filter(known);
  return known(v) ? v : null;
}

function matches(row: RowLike, rule: FilterRule, prop: PropertyDef | undefined, now: Date): boolean {
  const v = liveValue(row, rule.propertyId, prop);
  switch (rule.op) {
    case "is_within": {
      const day = valueDay(v);
      const range = relativeDateRange(rule.value, rule.days, now);
      return Boolean(day && range && day >= range.start && day <= range.end);
    }
    case "is_empty":
      return isEmpty(v);
    case "is_not_empty":
      return !isEmpty(v);
    case "contains": {
      const needle = String(rule.value ?? "").toLowerCase();
      if (Array.isArray(v)) return v.some((x) => String(x).toLowerCase() === needle);
      return String(v ?? "").toLowerCase().includes(needle);
    }
    case "equals":
      if (Array.isArray(v)) return v.includes(rule.value);
      return v === rule.value || String(v ?? "") === String(rule.value ?? "");
    case "not_equals":
      if (Array.isArray(v)) return !v.includes(rule.value);
      return String(v ?? "") !== String(rule.value ?? "");
    // Empty values never satisfy a comparison (otherwise "" < "5" would match every blank row).
    case "gt":
      if (isEmpty(v)) return false;
      return typeof v === "number" ? v > Number(rule.value) : String(v) > String(rule.value ?? "");
    case "lt":
      if (isEmpty(v)) return false;
      return typeof v === "number" ? v < Number(rule.value) : String(v) < String(rule.value ?? "");
  }
}

function compare(a: unknown, b: unknown): number {
  if (isEmpty(a) && isEmpty(b)) return 0;
  if (isEmpty(a)) return 1; // empties last regardless of direction
  if (isEmpty(b)) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/**
 * A rule the editor has added but not filled in yet ("Status is …"). It filters nothing, so every
 * consumer (app, published page, MCP) shows the same rows while the user is still picking.
 */
export function isIncompleteFilter(rule: FilterRule) {
  if (rule.op === "is_within") {
    return !isRelativeDateRange(rule.value) || (rangeNeedsDays(rule.value) && !isDayCount(rule.days));
  }
  return filterNeedsValue(rule.op) && (rule.value === undefined || rule.value === null || rule.value === "");
}

/**
 * Who is looking at a view (person filters on "me" match their rows), the names of the people
 * rows hold, which person sorts order by, and when: relative date filters ("this week") count
 * from `now`'s local day, the current time when left out.
 */
export type ViewViewer = { viewerId?: string | null; people?: { id: string; name: string }[]; now?: Date };

/**
 * A person rule's value with "me" swapped for the viewer's id. Without a viewer (a published
 * page) "me" is nobody, so "contains me" matches no row.
 */
function resolveViewer(rule: FilterRule, prop: PropertyDef | undefined, viewerId: string | null | undefined): FilterRule {
  if (!prop || !holdsPeople(prop.type) || rule.value !== PERSON_ME) return rule;
  return { ...rule, value: viewerId ?? "\u0000nobody" };
}

export function applyView<T extends RowLike>(
  rows: T[],
  {
    filters = [],
    filterCombinator,
    sorts = [],
  }: { filters?: FilterEntry[]; filterCombinator?: FilterCombinator; sorts?: SortRule[] },
  props: PropertyDef[] = [],
  { viewerId, people = [], now = new Date() }: ViewViewer = {},
): T[] {
  const byId = new Map(props.map((p) => [p.id, p]));
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  // Select sorts compare option order, not option ids; checkboxes sort unchecked < checked;
  // people sort by their names in the order they were added, so the first person counts most.
  const sortValue = (row: T, key: string) => {
    const prop = byId.get(key);
    const v = rawValue(row, key);
    const index = (id: unknown) => prop?.options.options?.findIndex((o) => o.id === id) ?? -1;
    if (prop?.type === "select") {
      const i = index(v);
      return i === -1 ? null : i;
    }
    if (prop?.type === "multi_select") {
      const indices = (Array.isArray(v) ? v.map(index) : []).filter((i) => i !== -1).sort((a, b) => a - b);
      return indices.length ? indices.map((i) => String(i).padStart(4, "0")).join(",") : null;
    }
    if (prop?.type === "checkbox") return v === true ? 1 : 0;
    if (prop && holdsPeople(prop.type)) {
      const names = (Array.isArray(v) ? v : []).flatMap((id) => {
        const name = typeof id === "string" ? nameOf.get(id) : undefined;
        return name ? [name] : [];
      });
      return names.length ? names.join("\u0000") : null;
    }
    return v;
  };
  const test = compileFilters<T>(
    pruneFilters(filters, (rule) => !isIncompleteFilter(rule)),
    filterCombinator,
    (rule) => {
      const prop = byId.get(rule.propertyId);
      const resolved = resolveViewer(rule, prop, viewerId);
      return (row) => matches(row, resolved, prop, now);
    },
  );
  const filtered = test ? rows.filter(test) : rows;
  if (!sorts.length) return filtered;
  return [...filtered].sort((a, b) => {
    for (const s of sorts) {
      const va = sortValue(a, s.propertyId);
      const vb = sortValue(b, s.propertyId);
      const bothPresent = !isEmpty(va) && !isEmpty(vb);
      const c = compare(va, vb) * (bothPresent && s.direction === "desc" ? -1 : 1);
      if (c !== 0) return c;
    }
    return 0;
  });
}

/** Message keys (`database.filter.ops.*`) for filter operator labels. */
export type FilterOpLabel =
  | "contains"
  | "doesNotContain"
  | "is"
  | "isNot"
  | "isEmpty"
  | "isNotEmpty"
  | "equals"
  | "notEquals"
  | "greaterThan"
  | "lessThan"
  | "isBefore"
  | "isAfter"
  | "isChecked"
  | "isUnchecked"
  | "isWithin";

/**
 * Filter operators offered per property type (`title` is the implicit Name column). `label` is a
 * message key under `database.filter.ops`, translated by the UI.
 */
export function filterOperators(type: PropertyType | "title"): { op: FilterOp; label: FilterOpLabel }[] {
  const empty = [
    { op: "is_empty" as const, label: "isEmpty" as const },
    { op: "is_not_empty" as const, label: "isNotEmpty" as const },
  ];
  switch (type) {
    case "title":
    case "text":
    case "url":
      return [
        { op: "contains", label: "contains" },
        { op: "equals", label: "is" },
        { op: "not_equals", label: "isNot" },
        ...empty,
      ];
    case "number":
      return [
        { op: "equals", label: "equals" },
        { op: "not_equals", label: "notEquals" },
        { op: "gt", label: "greaterThan" },
        { op: "lt", label: "lessThan" },
        ...empty,
      ];
    case "select":
      return [{ op: "equals", label: "is" }, { op: "not_equals", label: "isNot" }, ...empty];
    case "multi_select":
    case "relation":
    case "person":
    case "created_by":
      return [{ op: "contains", label: "contains" }, { op: "not_equals", label: "doesNotContain" }, ...empty];
    case "date":
      return [
        { op: "equals", label: "is" },
        { op: "lt", label: "isBefore" },
        { op: "gt", label: "isAfter" },
        { op: "is_within", label: "isWithin" },
        ...empty,
      ];
    case "checkbox":
      // `false` counts as empty, so unchecked rows match whether or not they were ever touched.
      return [
        { op: "is_not_empty", label: "isChecked" },
        { op: "is_empty", label: "isUnchecked" },
      ];
  }
}

/**
 * Values a new row needs so the view's filters keep showing it (Notion does the same): "Status is
 * Done" makes the row Done, "Tags contains X" tags it X, "Done is checked" ticks it, "Due is
 * within this week" dates it today (every relative range includes today). Rules that can't be
 * satisfied by one value (not equals, before/after, empty…) are left alone.
 *
 * Only rules every visible row must satisfy count, i.e. those joined by "and". Rules inside an
 * "or" are skipped rather than taking its first branch: an "or" names alternatives, and writing
 * one of them into the row would be a value the user never asked for (the row may well match
 * another branch through its other values).
 */
export function defaultsFromFilters(
  filters: FilterEntry[] = [],
  props: PropertyDef[] = [],
  { viewerId, now = new Date() }: ViewViewer = {},
  filterCombinator?: FilterCombinator,
) {
  const out: Record<string, unknown> = {};
  const active = pruneFilters(filters, (rule) => !isIncompleteFilter(rule));
  for (const rule of requiredFilterRules(active, filterCombinator)) {
    const prop = props.find((p) => p.id === rule.propertyId);
    if (!prop || prop.id in out) continue;
    if (prop.type === "checkbox") {
      if (rule.op === "is_not_empty") out[prop.id] = true;
      continue;
    }
    if (isIncompleteFilter(rule)) continue;
    if (rule.op === "equals" && ["select", "text", "number", "date"].includes(prop.type)) out[prop.id] = rule.value;
    else if (rule.op === "is_within" && prop.type === "date") out[prop.id] = dayString(now);
    else if (rule.op === "contains" && prop.type === "multi_select") out[prop.id] = [rule.value];
    else if (rule.op === "contains" && prop.type === "text") out[prop.id] = rule.value;
    else if (rule.op === "contains" && prop.type === "person") {
      // "Assignee contains me" assigns the new row to whoever creates it.
      const person = rule.value === PERSON_ME ? viewerId : rule.value;
      if (typeof person === "string" && person) out[prop.id] = [person];
    }
  }
  return out;
}

export function filterNeedsValue(op: FilterOp) {
  return op !== "is_empty" && op !== "is_not_empty";
}

/** Property types a view can sort by (relations hold row ids, which have no meaningful order). */
export function isSortable(type: PropertyType | "title") {
  return type !== "relation";
}

/** A position strictly between two neighbours (either may be missing) for manual ordering. */
export function positionBetween(before?: number | null, after?: number | null): number {
  const hasBefore = typeof before === "number" && Number.isFinite(before);
  const hasAfter = typeof after === "number" && Number.isFinite(after);
  if (hasBefore && hasAfter) return (before + after) / 2;
  if (hasBefore) return before + 1;
  if (hasAfter) return after - 1;
  return 1;
}

export type RowGroup<T> = {
  /** The column's option; for person columns a stand-in carrying the person's id and name. */
  option: SelectOption | null;
  /** Set on person columns. */
  person?: GroupPerson;
  rows: T[];
};

type GroupPerson = { id: string; name: string; active: boolean };

/** Property types a board can group by. */
export function isGroupable(type: PropertyType) {
  return type === "select" || holdsPeople(type);
}

/** The property a board groups by: the view's choice, else the first select, else the first people property. */
export function boardGroupProperty<P extends { id: string; type: PropertyType }>(props: P[], groupBy?: string) {
  const groupable = props.filter((p) => isGroupable(p.type));
  return groupable.find((p) => p.id === groupBy) ?? groupable.find((p) => p.type === "select") ?? groupable[0];
}

/**
 * Buckets rows by a person property: first the rows without anyone, then one column per person
 * in `people` order. A row assigned to several people shows in each of their columns. Former
 * members only get a column while someone is still assigned to them.
 */
export function groupRowsByPerson<T extends { properties: Record<string, unknown> }>(
  rows: T[],
  prop: { id: string },
  people: GroupPerson[],
): RowGroup<T>[] {
  const known = new Set(people.map((p) => p.id));
  const none: RowGroup<T> = { option: null, rows: [] };
  const byPerson = new Map(people.map((p) => [p.id, [] as T[]]));
  for (const row of rows) {
    const value = row.properties[prop.id];
    const ids = Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && known.has(id)) : [];
    if (!ids.length) none.rows.push(row);
    for (const id of new Set(ids)) byPerson.get(id)!.push(row);
  }
  const groups = people
    .filter((p) => p.active || byPerson.get(p.id)!.length)
    .map((person) => ({
      option: { id: person.id, name: person.name, color: "gray" },
      person,
      rows: byPerson.get(person.id)!,
    }));
  return [none, ...groups];
}

/** People added to person properties by a change, leaving out whoever made it (they know). */
export function newAssignees(
  personProps: { id: string }[],
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  actorId: string,
) {
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return personProps.flatMap((prop) => {
    const was = ids(before[prop.id]);
    return ids(after[prop.id])
      .filter((id) => id !== actorId && !was.includes(id))
      .map((userId) => ({ propertyId: prop.id, userId }));
  });
}

/**
 * A person value after dragging its card from one person's column (`from`, null for the no-person
 * column) to another's (`to`): `to` takes `from`'s place, everyone else stays. Dropping on the
 * no-person column unassigns everyone, so the card really lands there.
 */
export function movePersonValue(value: unknown, from: string | null | undefined, to: string | null | undefined): string[] {
  if (!to) return [];
  const ids = Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  if (ids.includes(to)) return from ? ids.filter((id) => id !== from) : ids;
  const at = from ? ids.indexOf(from) : -1;
  if (at === -1) return [...ids, to];
  return ids.map((id, i) => (i === at ? to : id));
}

/**
 * Buckets rows by a select property: first a group for rows without a (known) value, then one
 * group per option in option order. Row order within each group is preserved.
 */
export function groupRows<T extends { properties: Record<string, unknown> }>(
  rows: T[],
  prop: { id: string; options: PropertyOptions },
): RowGroup<T>[] {
  const options = prop.options.options ?? [];
  const groups: RowGroup<T>[] = options.map((option) => ({ option, rows: [] }));
  const none: RowGroup<T> = { option: null, rows: [] };
  const index = new Map(options.map((o, i) => [o.id, i]));
  for (const row of rows) {
    const value = row.properties[prop.id];
    const i = typeof value === "string" ? index.get(value) : undefined;
    (i === undefined ? none : groups[i]).rows.push(row);
  }
  return [none, ...groups];
}

/**
 * Board cards stay short: long text and numbers start hidden there until the user shows them.
 * Other views show every property unless hidden.
 */
export function hiddenByDefault(viewType: ViewType, propType: PropertyType): boolean {
  return viewType === "board" && (propType === "text" || propType === "number");
}

export function isHiddenInView(
  view: { type: ViewType; config: Pick<ViewConfig, "hidden" | "shown"> },
  prop: { id: string; type: PropertyType },
): boolean {
  if (view.config.hidden?.includes(prop.id)) return true;
  return hiddenByDefault(view.type, prop.type) && !view.config.shown?.includes(prop.id);
}

/** The config after flipping one property between shown and hidden. */
export function toggleHiddenInView(
  view: { type: ViewType; config: ViewConfig },
  prop: { id: string; type: PropertyType },
): ViewConfig {
  const hide = !isHiddenInView(view, prop);
  const hidden = (view.config.hidden ?? []).filter((id) => id !== prop.id);
  const shown = (view.config.shown ?? []).filter((id) => id !== prop.id);
  if (hide) hidden.push(prop.id);
  else if (hiddenByDefault(view.type, prop.type)) shown.push(prop.id);
  return { ...view.config, hidden, shown };
}

/** Puts board groups in the view's saved order; groups it doesn't list keep their relative order at the end. */
export function orderGroups<T>(groups: RowGroup<T>[], order: string[] | undefined): RowGroup<T>[] {
  if (!order?.length) return groups;
  const rank = new Map(order.map((key, i) => [key, i]));
  const keyed = groups.map((g, i) => ({ g, i, r: rank.get(g.option?.id ?? "") }));
  keyed.sort((a, b) => {
    if (a.r !== undefined && b.r !== undefined) return a.r - b.r;
    if (a.r !== undefined) return -1;
    if (b.r !== undefined) return 1;
    return a.i - b.i;
  });
  return keyed.map((k) => k.g);
}
