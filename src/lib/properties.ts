import type { FilterOp, FilterRule, PropertyOptions, PropertyType, SelectOption, SortRule } from "@/db/schema/app";

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

function matches(row: RowLike, rule: FilterRule): boolean {
  const v = rawValue(row, rule.propertyId);
  switch (rule.op) {
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

export function applyView<T extends RowLike>(
  rows: T[],
  { filters = [], sorts = [] }: { filters?: FilterRule[]; sorts?: SortRule[] },
  props: PropertyDef[] = [],
): T[] {
  const byId = new Map(props.map((p) => [p.id, p]));
  // Select sorts compare option order, not option ids.
  const sortValue = (row: T, key: string) => {
    const prop = byId.get(key);
    const v = rawValue(row, key);
    if (prop?.type === "select") {
      const index = prop.options.options?.findIndex((o) => o.id === v) ?? -1;
      return index === -1 ? null : index;
    }
    return v;
  };
  const filtered = rows.filter((row) => filters.every((rule) => matches(row, rule)));
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
  | "isUnchecked";

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
      return [{ op: "contains", label: "contains" }, { op: "not_equals", label: "doesNotContain" }, ...empty];
    case "date":
      return [
        { op: "equals", label: "is" },
        { op: "lt", label: "isBefore" },
        { op: "gt", label: "isAfter" },
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

export type RowGroup<T> = { option: SelectOption | null; rows: T[] };

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
