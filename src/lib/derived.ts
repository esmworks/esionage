import type { PropertyOptions, PropertyType } from "@/db/schema/app";
import {
  checkFormula,
  fail,
  fieldType,
  formatValue,
  FormulaFailure,
  parseFormula,
  rewriteReferences,
  runFormula,
  toDateValue,
  type Field,
  type FormulaError,
  type FormulaResultType,
  type FormulaType,
  type Node,
  type Value,
} from "./formula";
import type { RollupFn } from "./aggregate";
import { holdsPeople } from "./property-types";

/**
 * Derived properties: values worked out whenever rows are read, never stored. Rollups calculate
 * over the rows a row links to (the server works them out, see server/derived and lib/rollup);
 * formulas then compute from the row's own values, rollups included. Pure and client-safe: the
 * server fills them in for every read (app, MCP, CSV, published pages), and the browser
 * recomputes a row's formulas right away when the user edits it, with the same code.
 */

type Prop = { id: string; name: string; type: PropertyType; options: PropertyOptions };

/** Key of the row title in `prop("title")`. */
export const TITLE_FIELD = "title";

/** A value that couldn't be worked out for a row; stored in its place so every reader can show why. */
export type ErrorValue = { error: FormulaError };

export function isErrorValue(value: unknown): value is ErrorValue {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "error" in value;
}

/**
 * What a rollup's values are: a calculation's format (a percentage is a fraction, 0.25 = 25%; a
 * date range a number of days), or the related values themselves as a list of texts.
 */
export type RollupFormat = "number" | "percent" | "days" | "date" | "list";

export function rollupFormat(fn: RollupFn | undefined): RollupFormat {
  switch (fn) {
    case "show_original":
      return "list";
    case "percent_empty":
    case "percent_not_empty":
    case "percent_checked":
    case "percent_unchecked":
      return "percent";
    case "date_range":
      return "days";
    case "earliest_date":
    case "latest_date":
      return "date";
    default:
      return "number";
  }
}

/** How a formula sees a property's values. */
function baseType(prop: { type: PropertyType; options: PropertyOptions }): FormulaType | null {
  if (prop.type === "rollup") {
    const format = rollupFormat(prop.options.rollup?.function);
    return format === "list" ? "list" : format === "date" ? "date" : "number";
  }
  switch (prop.type) {
    case "text":
    case "url":
    case "email":
    case "phone":
    case "select":
    case "status":
      return "text";
    case "number":
    case "checklist":
      return "number";
    case "checkbox":
      return "checkbox";
    case "date":
    case "created_time":
    case "last_edited_time":
      return "date";
    case "multi_select":
    case "relation":
    case "person":
    case "created_by":
    case "last_edited_by":
      return "list";
    default:
      return null;
  }
}

/**
 * The type a derived property's values have (formulas: their result type, filled in when
 * properties are read), or null for other properties.
 */
export function derivedType(prop: { type: PropertyType; options: PropertyOptions }): FormulaResultType | null {
  if (prop.type === "formula") return prop.options.formula?.type ?? "text";
  if (prop.type === "rollup") {
    // A rollup listing the related values filters and sorts like text.
    const type = baseType(prop);
    return type === "list" ? "text" : type;
  }
  return null;
}

/**
 * The type filters, sorts and calculations treat a property as: a derived property counts as a
 * property of its result type (a number formula filters like a number).
 */
export function valueType(prop: { type: PropertyType; options: PropertyOptions }): PropertyType {
  return derivedType(prop) ?? prop.type;
}

export type CompiledFormula = {
  id: string;
  ast: Node | null;
  type: FormulaResultType;
  error: FormulaError | null;
};

function resolver(props: Prop[]) {
  const byId = new Map(props.map((p) => [p.id, p]));
  const byName = new Map<string, Prop>();
  for (const p of props) if (!byName.has(p.name.trim().toLowerCase())) byName.set(p.name.trim().toLowerCase(), p);
  /** A reference by property id, else by (case-insensitive) name, else the row title. */
  return (key: string): Prop | typeof TITLE_FIELD | undefined => {
    const found = byId.get(key) ?? byName.get(key.trim().toLowerCase());
    if (found) return found;
    return key.trim().toLowerCase() === TITLE_FIELD ? TITLE_FIELD : undefined;
  };
}

/** Formulas that depend on themselves, directly or through other formulas. */
function cyclic(formulas: Prop[], refsOf: (id: string) => string[]) {
  const out = new Set<string>();
  for (const f of formulas) {
    const seen = new Set<string>();
    const stack = [...refsOf(f.id)];
    while (stack.length) {
      const id = stack.pop()!;
      if (id === f.id) {
        out.add(f.id);
        break;
      }
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...refsOf(id));
    }
  }
  return out;
}

/**
 * Parses and type checks every formula of a database. A formula that depends on itself gets a
 * cycle error; one that uses a broken formula gets a reference error.
 */
export function compileFormulas(props: Prop[]): Map<string, CompiledFormula> {
  const resolve = resolver(props);
  const formulas = props.filter((p) => p.type === "formula");
  const parsed = new Map(formulas.map((f) => [f.id, parseFormula(f.options.formula?.expression ?? "")]));
  const refsOf = (id: string) =>
    (parsed.get(id)?.refs ?? []).flatMap((key) => {
      const target = resolve(key);
      return typeof target === "object" && target.type === "formula" ? [target.id] : [];
    });
  const loops = cyclic(formulas, refsOf);
  const out = new Map<string, CompiledFormula>();

  const compile = (f: Prop): CompiledFormula => {
    const done = out.get(f.id);
    if (done) return done;
    const formula = parsed.get(f.id)!;
    let result: CompiledFormula;
    if (loops.has(f.id)) {
      const error: FormulaError = { code: "cycle", message: `"${f.name}" refers back to itself`, params: { name: f.name } };
      result = { id: f.id, ast: null, type: "text", error };
    } else {
      const fields = (key: string): Field | undefined => {
        const target = resolve(key);
        if (!target) return undefined;
        if (target === TITLE_FIELD) return { name: TITLE_FIELD, type: "text" };
        if (target.type === "formula") {
          const compiled = compile(target);
          return { name: target.name, type: compiled.error ? null : fieldType(compiled.type) };
        }
        const type = baseType(target);
        return type ? { name: target.name, type } : undefined;
      };
      const { type, error } = checkFormula(formula, fields);
      result = { id: f.id, ast: error ? null : formula.ast, type, error };
    }
    out.set(f.id, result);
    return result;
  };
  for (const f of formulas) compile(f);
  return out;
}

/** Properties with each formula's result type filled in (see FormulaConfig.type). */
export function withFormulaTypes<P extends Prop>(props: P[]): P[] {
  if (!props.some((p) => p.type === "formula")) return props;
  const compiled = compileFormulas(props);
  return props.map((p) =>
    p.type === "formula"
      ? { ...p, options: { ...p.options, formula: { expression: p.options.formula?.expression ?? "", type: compiled.get(p.id)!.type } } }
      : p,
  );
}

/** Whether any formula reads people or related rows, which need names and titles to evaluate. */
export function formulasNeedLookups(props: Prop[]) {
  const resolve = resolver(props);
  return props.some(
    (p) =>
      p.type === "formula" &&
      parseFormula(p.options.formula?.expression ?? "").refs.some((key) => {
        const target = resolve(key);
        return typeof target === "object" && (target.type === "relation" || holdsPeople(target.type));
      }),
  );
}

/**
 * What formulas need besides the row: the time (`now()`, `today()`), and the names of people and
 * titles of related rows the viewer may see (people and relations read as lists of those).
 */
export type FormulaContext = {
  now: Date;
  people?: { id: string; name: string }[];
  relations?: Record<string, { rows: { id: string; title: string }[] } | undefined>;
};

const DAY_OR_TIME = (v: unknown) => toDateValue(v);

function optionName(prop: Prop, id: unknown) {
  return prop.options.options?.find((o) => o.id === id)?.name;
}

function ids(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}

/**
 * A value as a formula reads it (also what a rollup showing the original values lists). Other
 * derived values must already be worked out: formulas read the stored result, rollups theirs.
 */
export function readPropertyValue(prop: Prop, value: unknown, ctx: FormulaContext): Value {
  let peopleNames: Map<string, string> | undefined;
  return readValue(prop, value, ctx, () => (peopleNames ??= new Map((ctx.people ?? []).map((p) => [p.id, p.name]))));
}

function readValue(prop: Prop, value: unknown, ctx: FormulaContext, names: () => Map<string, string>): Value {
  if (isErrorValue(value)) return null;
  switch (prop.type) {
    case "text":
    case "url":
    case "email":
    case "phone":
      return value === null || value === undefined ? "" : String(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    case "checkbox":
      return value === true;
    case "select":
    case "status":
      return optionName(prop, value) ?? "";
    case "multi_select":
      return ids(value).flatMap((id) => optionName(prop, id) ?? []);
    case "date":
    case "created_time":
    case "last_edited_time":
      return DAY_OR_TIME(value);
    case "checklist": {
      // The share of ticked items, like checklist sorts.
      if (!Array.isArray(value) || !value.length) return null;
      return value.filter((item) => (item as { checked?: unknown })?.checked === true).length / value.length;
    }
    case "relation": {
      const titles = new Map((ctx.relations?.[prop.id]?.rows ?? []).map((r) => [r.id, r.title]));
      return ids(value).flatMap((id) => (titles.has(id) ? [titles.get(id)!] : []));
    }
    case "person":
    case "created_by":
    case "last_edited_by": {
      const byId = names();
      return ids(value).flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
    }
    case "rollup":
    case "formula": {
      // The worked-out value, read by its type.
      const type = prop.type === "rollup" ? baseType(prop) : derivedType(prop);
      if (type === "list") return ids(value);
      if (type === "date") return toDateValue(value);
      if (type === "number") return typeof value === "number" && Number.isFinite(value) ? value : null;
      if (type === "checkbox") return value === true;
      return typeof value === "string" ? value : "";
    }
    default:
      return null;
  }
}

/**
 * Every formula's value for one row, keyed by property id: what gets merged into the row's
 * properties (a number, text, boolean or date string, null when empty, or an ErrorValue).
 * `row.properties` must already hold the row's other derived and system values.
 */
export function evaluateFormulas(
  props: Prop[],
  compiled: Map<string, CompiledFormula>,
  row: { title: string; properties: Record<string, unknown> },
  ctx: FormulaContext,
): Record<string, unknown> {
  const resolve = resolver(props);
  let peopleNames: Map<string, string> | undefined;
  const names = () => (peopleNames ??= new Map((ctx.people ?? []).map((p) => [p.id, p.name])));
  const results = new Map<string, { raw: Value; stored: unknown } | { error: FormulaError }>();

  const run = (id: string) => {
    const known = results.get(id);
    if (known) return known;
    const formula = compiled.get(id)!;
    let result: { raw: Value; stored: unknown } | { error: FormulaError };
    if (formula.error) result = { error: formula.error };
    else {
      try {
        result = runFormula(formula.ast, { value, now: ctx.now });
      } catch (error) {
        if (!(error instanceof FormulaFailure)) throw error;
        result = { error: error.error };
      }
    }
    results.set(id, result);
    return result;
  };

  function value(key: string): Value {
    const target = resolve(key);
    if (!target) return fail("unknownProperty", `Unknown property "${key}"`, { name: key });
    if (target === TITLE_FIELD) return row.title ?? "";
    if (target.type === "formula") {
      const result = run(target.id);
      if ("error" in result) return fail("referenceError", `"${target.name}" has an error`, { name: target.name });
      // Other formulas see a list result as the text it is stored as.
      return Array.isArray(result.raw) ? formatValue(result.raw) : result.raw;
    }
    const stored = row.properties[target.id];
    // A rollup that couldn't be worked out for this row.
    if (isErrorValue(stored)) return fail("referenceError", `"${target.name}" has an error`, { name: target.name });
    return readValue(target, stored, ctx, names);
  }

  const out: Record<string, unknown> = {};
  for (const id of compiled.keys()) {
    const result = run(id);
    out[id] = "error" in result ? { error: result.error } : result.stored;
  }
  return out;
}

/** Row values with every formula filled in (compiles the schema; use evaluateFormulas in loops). */
export function withFormulas<R extends { title: string; properties: Record<string, unknown> }>(
  props: Prop[],
  rows: R[],
  ctx: FormulaContext,
): R[] {
  if (!props.some((p) => p.type === "formula")) return rows;
  const compiled = compileFormulas(props);
  return rows.map((row) => ({ ...row, properties: { ...row.properties, ...evaluateFormulas(props, compiled, row, ctx) } }));
}

/**
 * An expression as the user edits it: property ids in `prop("…")` replaced by current names, and
 * the title by `titleName` (the Name column's label) unless a property is called that.
 */
export function formulaForEditing(expression: string, props: { id: string; name: string }[], titleName = TITLE_FIELD) {
  const byId = new Map(props.map((p) => [p.id, p.name]));
  const titleTaken = props.some((p) => p.name.trim().toLowerCase() === titleName.trim().toLowerCase());
  return rewriteReferences(expression, (key) => {
    if (byId.has(key)) return byId.get(key)!;
    if (key === TITLE_FIELD && !titleTaken) return titleName;
    return null;
  });
}

/**
 * An expression as stored: names in `prop("…")` replaced by property ids, and `titleNames` (such
 * as "title" and the Name column's label) by "title". Unknown names stay, so checking reports them.
 */
export function formulaForStorage(text: string, props: { id: string; name: string }[], titleNames: string[] = []) {
  const byId = new Set(props.map((p) => p.id));
  const byName = new Map<string, string>();
  for (const p of props) if (!byName.has(p.name.trim().toLowerCase())) byName.set(p.name.trim().toLowerCase(), p.id);
  const titles = new Set([TITLE_FIELD, ...titleNames.map((n) => n.trim().toLowerCase())]);
  return rewriteReferences(text, (key) => {
    if (byId.has(key)) return key;
    const needle = key.trim().toLowerCase();
    if (byName.has(needle)) return byName.get(needle)!;
    return titles.has(needle) ? TITLE_FIELD : null;
  });
}
