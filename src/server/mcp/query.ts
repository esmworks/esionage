import type { FilterOp, FilterRule, PropertyOptions, PropertyType, SortRule, ViewConfig } from "@/db/schema/app";
import { CREATED_KEY, displayValue, PropertyValueError, TITLE_KEY, UPDATED_KEY } from "@/lib/properties";

export type PropertyDef = { id: string; name: string; type: PropertyType; options: PropertyOptions };

export const FILTER_OPS = ["contains", "equals", "not_equals", "is_empty", "is_not_empty", "gt", "lt"] as const satisfies readonly FilterOp[];

const SPECIAL_KEYS: Record<string, string> = {
  title: TITLE_KEY,
  created_at: CREATED_KEY,
  updated_at: UPDATED_KEY,
};

const VALUE_OPS = new Set<FilterOp>(["contains", "equals", "not_equals", "gt", "lt"]);

function available(props: PropertyDef[]) {
  return ["title", "created_at", "updated_at", ...props.map((p) => `${p.name} (${p.type})`)].join(", ");
}

/** Resolves a property reference (id, case-insensitive name, or a special key) to its storage key. */
export function resolvePropertyKey(props: PropertyDef[], key: string): { key: string; prop?: PropertyDef } {
  const byId = props.find((p) => p.id === key);
  if (byId) return { key: byId.id, prop: byId };
  const needle = key.trim().toLowerCase();
  const byName = props.find((p) => p.name.trim().toLowerCase() === needle);
  if (byName) return { key: byName.id, prop: byName };
  const special = SPECIAL_KEYS[needle];
  if (special) return { key: special };
  throw new PropertyValueError(`Unknown property "${key}". Available: ${available(props)}`);
}

function optionId(prop: PropertyDef, value: unknown): string {
  const options = prop.options.options ?? [];
  const needle = String(value ?? "").trim().toLowerCase();
  const option = options.find((o) => o.id === value || o.name.trim().toLowerCase() === needle);
  if (!option) {
    throw new PropertyValueError(
      `"${String(value)}" is not an option of "${prop.name}". Options: ${options.map((o) => o.name).join(", ") || "none"}`,
    );
  }
  return option.id;
}

export type FilterInput = { property: string; op: FilterOp; value?: unknown };
export type SortInput = { property: string; direction?: "asc" | "desc" };

/** Converts an agent-facing filter (names, option names) to a stored FilterRule (ids). */
export function toFilterRule(props: PropertyDef[], input: FilterInput): FilterRule {
  const { key, prop } = resolvePropertyKey(props, input.property);
  if (!VALUE_OPS.has(input.op)) return { propertyId: key, op: input.op };
  if (input.value === undefined || input.value === null || input.value === "") {
    throw new PropertyValueError(`Filter "${input.op}" on "${input.property}" needs a value`);
  }
  let value: unknown = input.value;
  if (prop?.type === "select" || prop?.type === "multi_select") {
    if (input.op === "gt" || input.op === "lt") {
      throw new PropertyValueError(`"${input.op}" is not supported on select property "${prop.name}"`);
    }
    value = optionId(prop, value);
  } else if (prop?.type === "checkbox") {
    if (value === "true") value = true;
    else if (value === "false") value = false;
  } else if (prop?.type === "number" && (input.op === "gt" || input.op === "lt" || input.op === "equals" || input.op === "not_equals")) {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) throw new PropertyValueError(`"${prop.name}" filter value must be a number`);
    value = n;
  }
  return { propertyId: key, op: input.op, value };
}

export function toSortRule(props: PropertyDef[], input: SortInput): SortRule {
  return { propertyId: resolvePropertyKey(props, input.property).key, direction: input.direction ?? "asc" };
}

/** Row values keyed by property name with option names instead of ids. Empty values are omitted. */
export function displayProperties(props: PropertyDef[], values: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const prop of props) {
    const value = displayValue(prop, values[prop.id]);
    if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) continue;
    out[prop.name] = value;
  }
  return out;
}

function keyName(props: PropertyDef[], key: string) {
  return props.find((p) => p.id === key)?.name ?? key;
}

/** A view's stored config with property and option names, for get_database output. */
export function describeViewConfig(props: PropertyDef[], config: ViewConfig) {
  const byId = new Map(props.map((p) => [p.id, p]));
  return {
    ...(config.groupBy ? { group_by: keyName(props, config.groupBy) } : {}),
    ...(config.filters?.length
      ? {
          filters: config.filters.map((f) => {
            const prop = byId.get(f.propertyId);
            const value = prop && f.value !== undefined ? (displayValue(prop, f.value) ?? f.value) : f.value;
            return { property: keyName(props, f.propertyId), op: f.op, ...(value !== undefined ? { value } : {}) };
          }),
        }
      : {}),
    ...(config.sorts?.length
      ? { sorts: config.sorts.map((s) => ({ property: keyName(props, s.propertyId), direction: s.direction })) }
      : {}),
  };
}

export function describeProperty(prop: PropertyDef) {
  return {
    id: prop.id,
    name: prop.name,
    type: prop.type,
    ...(prop.type === "select" || prop.type === "multi_select"
      ? { options: (prop.options.options ?? []).map((o) => o.name) }
      : {}),
  };
}
