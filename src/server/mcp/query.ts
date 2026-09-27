import type {
  FilterCombinator,
  FilterEntry,
  FilterOp,
  FilterRule,
  PropertyOptions,
  PropertyType,
  SortRule,
  ViewConfig,
} from "@/db/schema/app";
import {
  isDayCount,
  isFilterGroup,
  isRelativeDateRange,
  MAX_FILTER_DEPTH,
  MAX_FILTER_RULES,
  MAX_RELATIVE_DAYS,
  RELATIVE_DATE_RANGES,
  rangeNeedsDays,
} from "@/lib/filters";
import { pageLabel } from "@/lib/labels";
import {
  CREATED_KEY,
  displayValue,
  isSortable,
  PropertyValueError,
  sortStatusOptions,
  TITLE_KEY,
  UPDATED_KEY,
} from "@/lib/properties";
import { holdsOptions, holdsPeople, holdsTimestamp, isComputed, PERSON_ME, STATUS_GROUPS } from "@/lib/property-types";

export type PropertyDef = { id: string; name: string; type: PropertyType; options: PropertyOptions };

/** Related database and its live rows per relation property id (see databases.getRelationTargets). */
export type RelationTargets = Record<
  string,
  { database: { id: string; title: string } | null; pairedName?: string | null; rows: { id: string; title: string }[] }
>;

/** People person properties can show and hold (see databases.getPeople). */
export type PersonLookup = { id: string; name: string; email: string | null; active?: boolean };

/** Everything needed to show linked rows and people by name (see databases.getLookups). */
export type Lookups = { relations: RelationTargets; people: PersonLookup[] };

const NO_LOOKUPS: Lookups = { relations: {}, people: [] };

/** A related row by id or (case-insensitive, unique) title. */
function relatedRowId(prop: PropertyDef, targets: RelationTargets, value: unknown): string {
  const rows = targets[prop.id]?.rows ?? [];
  const raw = String(value ?? "").trim();
  const byId = rows.find((r) => r.id === raw);
  if (byId) return byId.id;
  const matches = rows.filter((r) => r.title.trim().toLowerCase() === raw.toLowerCase());
  if (matches.length === 1) return matches[0].id;
  throw new PropertyValueError(
    matches.length
      ? `"${raw}" matches ${matches.length} rows related to "${prop.name}"; use a row id`
      : `"${raw}" is not a row of the database related to "${prop.name}"`,
  );
}

/**
 * A person filter value: "me" stays "me" (it means whoever looks at the view), anything else is a
 * user id, email or (unique, case-insensitive) name of someone the caller can see.
 */
function personId(prop: PropertyDef, people: PersonLookup[], value: unknown): string {
  const raw = String(value ?? "").trim();
  if (raw.toLowerCase() === PERSON_ME) return PERSON_ME;
  const needle = raw.toLowerCase();
  const found =
    people.find((p) => p.id === raw) ??
    people.find((p) => p.email?.toLowerCase() === needle) ??
    (() => {
      const byName = people.filter((p) => p.name.trim().toLowerCase() === needle);
      if (byName.length > 1) {
        throw new PropertyValueError(`"${raw}" matches ${byName.length} people for "${prop.name}"; use an email or user id`);
      }
      return byName[0];
    })();
  if (!found) throw new PropertyValueError(`"${raw}" is not a person in this workspace (filter on "${prop.name}")`);
  return found.id;
}

export { FILTER_OPS } from "@/lib/filters";

const SPECIAL_KEYS: Record<string, string> = {
  title: TITLE_KEY,
  created_at: CREATED_KEY,
  updated_at: UPDATED_KEY,
};

const VALUE_OPS = new Set<FilterOp>(["contains", "equals", "not_equals", "gt", "lt", "is_within"]);

/** Whether a property (or built-in key) holds dates or timestamps that relative date filters apply to. */
function holdsDates(key: string, prop: PropertyDef | undefined) {
  return prop ? prop.type === "date" || holdsTimestamp(prop.type) : key === CREATED_KEY || key === UPDATED_KEY;
}

const PEOPLE_LABELS: Record<string, string> = { person: "Person", created_by: "Created by", last_edited_by: "Last edited by" };

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

export type FilterInput = { property: string; op: FilterOp; value?: unknown; days?: number };
export type FilterGroupInput = { type: "group"; combinator?: FilterCombinator; rules: FilterEntryInput[] };
export type FilterEntryInput = FilterInput | FilterGroupInput;
export type SortInput = { property: string; direction?: "asc" | "desc" };

/** Converts an agent-facing filter (names, option names) to a stored FilterRule (ids). */
export function toFilterRule(props: PropertyDef[], input: FilterInput, lookups: Lookups = NO_LOOKUPS): FilterRule {
  const { key, prop } = resolvePropertyKey(props, input.property);
  if (input.days !== undefined && input.op !== "is_within") {
    throw new PropertyValueError(`"days" only applies to is_within filters (on "${input.property}")`);
  }
  if (!VALUE_OPS.has(input.op)) return { propertyId: key, op: input.op };
  if (input.value === undefined || input.value === null || input.value === "") {
    throw new PropertyValueError(`Filter "${input.op}" on "${input.property}" needs a value`);
  }
  if (input.op === "is_within") return relativeDateRule(key, prop, input);
  let value: unknown = input.value;
  if (prop?.type === "checklist") {
    throw new PropertyValueError(`Checklist "${prop.name}" supports is_empty and is_not_empty`);
  } else if (prop && holdsTimestamp(prop.type)) {
    if (input.op !== "equals" && input.op !== "gt" && input.op !== "lt") {
      throw new PropertyValueError(`"${prop.name}" supports equals (on the day), gt (after), lt (before), is_within, is_empty and is_not_empty`);
    }
    const day = String(value);
    if (!/^\d{4}-\d{2}-\d{2}/.test(day) || Number.isNaN(Date.parse(day.slice(0, 10)))) {
      throw new PropertyValueError(`"${prop.name}" filter value must be a date (YYYY-MM-DD)`);
    }
    value = day.slice(0, 10);
  } else if (prop?.type === "relation") {
    if (input.op !== "contains" && input.op !== "not_equals") {
      throw new PropertyValueError(
        `Relation "${prop.name}" supports contains, not_equals (does not contain), is_empty and is_not_empty`,
      );
    }
    value = relatedRowId(prop, lookups.relations, value);
  } else if (prop && holdsPeople(prop.type)) {
    if (input.op !== "contains" && input.op !== "not_equals") {
      throw new PropertyValueError(
        `${PEOPLE_LABELS[prop.type]} "${prop.name}" supports contains, not_equals (does not contain), is_empty and is_not_empty`,
      );
    }
    value = personId(prop, lookups.people, value);
  } else if (prop && holdsOptions(prop.type)) {
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

/** An is_within rule: a relative range on a date, plus a day count for past / next N days. */
function relativeDateRule(key: string, prop: PropertyDef | undefined, input: FilterInput): FilterRule {
  if (!holdsDates(key, prop)) {
    throw new PropertyValueError(
      `is_within only applies to date, created_time and last_edited_time properties and created_at / updated_at; "${input.property}" is ${prop?.type ?? "text"}`,
    );
  }
  const range = String(input.value).trim().toLowerCase();
  if (!isRelativeDateRange(range)) {
    throw new PropertyValueError(`is_within takes one of: ${RELATIVE_DATE_RANGES.join(", ")} (got "${String(input.value)}")`);
  }
  if (!rangeNeedsDays(range)) {
    if (input.days !== undefined) throw new PropertyValueError(`"days" only applies to past_n_days and next_n_days`);
    return { propertyId: key, op: "is_within", value: range };
  }
  if (!isDayCount(input.days)) {
    throw new PropertyValueError(`${range} needs "days", a whole number from 1 to ${MAX_RELATIVE_DAYS}`);
  }
  return { propertyId: key, op: "is_within", value: range, days: input.days };
}

/**
 * Converts agent-facing filters (rules and groups, see toFilterRule) to a stored filter tree.
 * Groups may nest MAX_FILTER_DEPTH levels; a group's combinator defaults to "and".
 */
export function toFilterEntries(props: PropertyDef[], inputs: FilterEntryInput[], lookups: Lookups = NO_LOOKUPS): FilterEntry[] {
  let count = 0;
  const convert = (entries: FilterEntryInput[], depth: number): FilterEntry[] =>
    entries.map((entry) => {
      if ("type" in entry && entry.type === "group") {
        if (depth >= MAX_FILTER_DEPTH) {
          throw new PropertyValueError(`Filter groups can be nested at most ${MAX_FILTER_DEPTH} levels deep`);
        }
        if (!entry.rules.length) throw new PropertyValueError("A filter group needs at least one rule");
        return { type: "group", combinator: entry.combinator ?? "and", rules: convert(entry.rules, depth + 1) };
      }
      if (++count > MAX_FILTER_RULES) throw new PropertyValueError(`A view can have at most ${MAX_FILTER_RULES} filter rules`);
      return toFilterRule(props, entry as FilterInput, lookups);
    });
  return convert(inputs, 0);
}

export function toSortRule(props: PropertyDef[], input: SortInput): SortRule {
  const { key, prop } = resolvePropertyKey(props, input.property);
  if (prop && !isSortable(prop.type)) {
    throw new PropertyValueError(`Relation "${prop.name}" can't be sorted`);
  }
  return { propertyId: key, direction: input.direction ?? "asc" };
}

/**
 * Row values keyed by property name with option names instead of ids, related rows as
 * `{id, title}` and people as `{id, name}`. Empty values are omitted.
 */
export function displayProperties(props: PropertyDef[], values: Record<string, unknown>, lookups: Lookups = NO_LOOKUPS) {
  const out: Record<string, unknown> = {};
  for (const prop of props) {
    const value =
      prop.type === "relation"
        ? relatedRows(prop, lookups.relations, values[prop.id])
        : holdsPeople(prop.type)
          ? assignedPeople(lookups.people, values[prop.id])
          : displayValue(prop, values[prop.id]);
    if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) continue;
    out[prop.name] = value;
  }
  return out;
}

function relatedRows(prop: PropertyDef, targets: RelationTargets, value: unknown) {
  if (!Array.isArray(value)) return null;
  const byId = new Map((targets[prop.id]?.rows ?? []).map((r) => [r.id, r]));
  return value.flatMap((id) => {
    const row = byId.get(id);
    return row ? [{ id: row.id, title: pageLabel(row.title) }] : [];
  });
}

/** People of a person value the caller can see; ids of unknown people are left out. */
function assignedPeople(people: PersonLookup[], value: unknown) {
  if (!Array.isArray(value)) return null;
  const byId = new Map(people.map((p) => [p.id, p]));
  return value.flatMap((id) => {
    const person = byId.get(id);
    return person ? [{ id: person.id, name: person.name }] : [];
  });
}

function keyName(props: PropertyDef[], key: string) {
  return props.find((p) => p.id === key)?.name ?? key;
}

/** A view's stored config with property and option names, for get_database output. */
export function describeViewConfig(props: PropertyDef[], config: ViewConfig, lookups: Lookups = NO_LOOKUPS) {
  const byId = new Map(props.map((p) => [p.id, p]));
  const describeEntry = (f: FilterEntry): object => {
    if (isFilterGroup(f)) return { type: "group", combinator: f.combinator, rules: f.rules.map(describeEntry) };
    const prop = byId.get(f.propertyId);
    const value = prop && f.value !== undefined && f.op !== "is_within" ? filterValue(prop, f.value) : f.value;
    return {
      property: keyName(props, f.propertyId),
      op: f.op,
      ...(value !== undefined ? { value } : {}),
      ...(f.days !== undefined ? { days: f.days } : {}),
    };
  };
  const filterValue = (prop: PropertyDef, value: unknown) => {
    if (holdsPeople(prop.type)) return lookups.people.find((p) => p.id === value)?.name ?? value;
    if (prop.type !== "relation") return displayValue(prop, value) ?? value;
    const row = lookups.relations[prop.id]?.rows.find((r) => r.id === value);
    return row ? pageLabel(row.title) : value;
  };
  return {
    ...(config.groupBy ? { group_by: keyName(props, config.groupBy) } : {}),
    ...(config.dateBy ? { date_by: keyName(props, config.dateBy) } : {}),
    ...(config.endDateBy ? { end_date_by: keyName(props, config.endDateBy) } : {}),
    ...(config.zoom ? { zoom: config.zoom } : {}),
    ...(config.showTable === false ? { show_table: false } : {}),
    ...(config.cardSize ? { card_size: config.cardSize } : {}),
    ...(config.cover ? { cover: config.cover.source } : {}),
    ...(config.filters?.length ? { filters: config.filters.map(describeEntry) } : {}),
    ...(config.filters?.length && config.filterCombinator === "or" ? { filter_combinator: "or" } : {}),
    ...(config.sorts?.length
      ? { sorts: config.sorts.map((s) => ({ property: keyName(props, s.propertyId), direction: s.direction })) }
      : {}),
  };
}

export function describeProperty(prop: PropertyDef, lookups: Lookups = NO_LOOKUPS) {
  const relation = prop.type === "relation" ? prop.options.relation : undefined;
  const target = lookups.relations[prop.id];
  return {
    id: prop.id,
    name: prop.name,
    type: prop.type,
    ...(holdsOptions(prop.type) ? { options: (prop.options.options ?? []).map((o) => o.name) } : {}),
    ...(prop.type === "status" ? { status_groups: statusGroups(prop) } : {}),
    ...(relation
      ? {
          // A related database they can't see isn't named, not even by id.
          ...(target && !target.database ? {} : { related_database_id: relation.databaseId }),
          ...(target?.database ? { related_database: pageLabel(target.database.title) } : {}),
          two_way: Boolean(relation.pairedPropertyId),
          ...(target?.pairedName ? { paired_property: target.pairedName } : {}),
        }
      : {}),
    ...(prop.type === "person"
      ? {
          people: lookups.people
            .filter((p) => p.active !== false)
            .map((p) => ({ id: p.id, name: p.name, ...(p.email ? { email: p.email } : {}) })),
        }
      : {}),
    ...(isComputed(prop.type) ? { read_only: true } : {}),
  };
}

/** Option names of a status property per group, in order. */
function statusGroups(prop: PropertyDef) {
  const options = sortStatusOptions(prop.options.options ?? []);
  return Object.fromEntries(STATUS_GROUPS.map((group) => [group, options.filter((o) => o.group === group).map((o) => o.name)]));
}
