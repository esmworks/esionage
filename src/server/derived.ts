import type { databaseProperty } from "@/db/schema";
import { compileFormulas, evaluateFormulas, formulasNeedLookups, type FormulaContext } from "@/lib/derived";

type Property = typeof databaseProperty.$inferSelect;

/** Names of people and titles of related rows, as the viewer may see them (see databases.getLookups). */
export type FormulaLookups = Pick<FormulaContext, "people" | "relations">;

export type DerivedOptions = {
  /** Loads the names and titles formulas of these properties' database may show. */
  lookups: (properties: Property[]) => Promise<FormulaLookups>;
  /** What `now()` and `today()` see; one instant for the whole read. */
  now?: Date;
};

/**
 * Rows with their derived values filled in: every formula, evaluated once per row. Rows must
 * already carry their stored and system values (who and when). Formulas that show people or
 * related rows get their names and titles from `lookups`, loaded only when one needs them.
 */
export async function computeDerived<R extends { title: string; properties: Record<string, unknown> }>(
  rows: R[],
  properties: Property[],
  options: DerivedOptions,
): Promise<R[]> {
  if (!rows.length || !properties.some((p) => p.type === "formula")) return rows;
  const lookups = formulasNeedLookups(properties) ? await options.lookups(properties) : {};
  const compiled = compileFormulas(properties);
  const context: FormulaContext = { now: options.now ?? new Date(), ...lookups };
  return rows.map((row) => ({
    ...row,
    properties: { ...row.properties, ...evaluateFormulas(properties, compiled, row, context) },
  }));
}
