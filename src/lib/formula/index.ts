import { storeDate } from "./dates";
import { check, evaluate, formatValue, type EvalEnv, type FieldResolver } from "./engine";
import { quote, tokenize } from "./lexer";
import { parse, references, type Node } from "./parser";
import { fail, FormulaFailure, type FormulaError, type FormulaResultType, type FormulaType, type Value } from "./types";

/**
 * The formula language: `prop("Name")` references, literals, operators and functions (see
 * engine.ts). Pure and client-safe; `lib/derived` applies it to database properties and rows.
 */

export { DATE_UNITS } from "./dates";
export { FORMULA_FUNCTIONS, formatValue, isEmptyValue, type EvalEnv, type Field, type FieldResolver, type FormulaFunctionGroup } from "./engine";
export { toDateValue } from "./dates";
export * from "./types";
export type { Node } from "./parser";

export type ParsedFormula = { ast: Node | null; refs: string[]; error: FormulaError | null };

// Rows are evaluated many times per expression; parsing once per distinct expression is enough.
const parsed = new Map<string, ParsedFormula>();
const MAX_CACHED = 500;

function asError(error: unknown): FormulaError {
  if (error instanceof FormulaFailure) return error.error;
  throw error;
}

/** Parses an expression (cached). Empty expressions parse to a null tree. */
export function parseFormula(expression: string): ParsedFormula {
  const hit = parsed.get(expression);
  if (hit) return hit;
  let result: ParsedFormula;
  try {
    const ast = parse(expression);
    result = { ast, refs: references(ast), error: null };
  } catch (error) {
    result = { ast: null, refs: [], error: asError(error) };
  }
  if (parsed.size >= MAX_CACHED) parsed.delete(parsed.keys().next().value!);
  parsed.set(expression, result);
  return result;
}

/**
 * The type a parsed formula produces with these fields, or the first error. An empty formula is
 * empty text. A list result is stored as text (items joined with ", ").
 */
export function checkFormula(formula: ParsedFormula, fields: FieldResolver): { type: FormulaResultType; error: FormulaError | null } {
  if (formula.error) return { type: "text", error: formula.error };
  if (!formula.ast) return { type: "text", error: null };
  try {
    const type = check(formula.ast, fields);
    return { type: type === "list" ? "text" : type, error: null };
  } catch (error) {
    return { type: "text", error: asError(error) };
  }
}

/**
 * Evaluates a checked formula on one row and returns the value to store: a number, text, boolean,
 * or a date as YYYY-MM-DD / ISO timestamp; null when empty. Throws a FormulaFailure when the row
 * can't be evaluated.
 */
export function runFormula(ast: Node | null, env: EvalEnv): { raw: Value; stored: unknown } {
  if (!ast) return { raw: "", stored: null };
  const raw = evaluate(ast, env);
  return { raw, stored: storedValue(raw) };
}

export function storedValue(raw: Value): unknown {
  if (raw === null) return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) fail("notFinite", "The result is not a finite number");
    return raw;
  }
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") return raw === "" ? null : raw;
  if (Array.isArray(raw)) return raw.length ? formatValue(raw) : null;
  return storeDate(raw);
}

/** A formula's own `list` values read as text by other formulas (they are stored joined). */
export function fieldType(type: FormulaType): FormulaType {
  return type === "list" ? "text" : type;
}

/**
 * Rewrites the key of every `prop("…")` in an expression; `map` returns the new key, or null to
 * keep it. The rest of the text stays exactly as typed. Text after a spot the tokenizer can't read
 * (an unclosed quote while typing) is kept unchanged.
 */
export function rewriteReferences(expression: string, map: (key: string) => string | null): string {
  const tokens = tokenize(expression, { tolerant: true });
  let out = "";
  let last = 0;
  for (let i = 0; i < tokens.length; i++) {
    const [name, open, arg, close] = [tokens[i], tokens[i + 1], tokens[i + 2], tokens[i + 3]];
    if (
      name?.kind === "name" &&
      name.value.toLowerCase() === "prop" &&
      open?.kind === "punct" &&
      open.value === "(" &&
      arg?.kind === "string" &&
      close?.kind === "punct" &&
      close.value === ")"
    ) {
      const next = map(arg.value);
      if (next !== null && next !== arg.value) {
        out += expression.slice(last, arg.start) + quote(next);
        last = arg.end;
      }
    }
  }
  return out + expression.slice(last);
}
