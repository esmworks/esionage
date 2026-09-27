import type { PageKind, PropertyOptions, PropertyType, RowProperties, ViewConfig, ViewType } from "@/db/schema/app";
import { mapFilterRules } from "./filters";

/**
 * Pure planning for "Duplicate page": given the source subtree, decides every new id and rewrites
 * the references between copied things (row values, view configs, relations). No database access,
 * so it can be tested on its own; `src/server/duplicate.ts` loads the input and writes the plan.
 */

export type SourcePage = {
  id: string;
  parentId: string | null;
  kind: PageKind;
  title: string;
  position: number;
  properties: RowProperties;
};
export type SourceProperty = {
  id: string;
  databaseId: string;
  name: string;
  type: PropertyType;
  options: PropertyOptions;
  position: number;
};
export type SourceView = { id: string; databaseId: string; name: string; type: ViewType; config: ViewConfig; position: number };

export type DuplicateInput = {
  rootId: string;
  /** The root and every descendant to copy; each non-root page's parent must be in the list. */
  pages: SourcePage[];
  /** Properties and views of the databases among `pages`. */
  properties: SourceProperty[];
  views: SourceView[];
  rootTitle: string;
  rootPosition: number;
};

export type PlannedPage = Omit<SourcePage, "id"> & { id: string; sourceId: string };
export type DuplicatePlan = {
  rootId: string;
  /** Source page id → copy id. */
  pageIds: Map<string, string>;
  pages: PlannedPage[];
  properties: SourceProperty[];
  views: SourceView[];
};

/** Maps an id through `map`, keeping ids it doesn't know (special keys such as "title", stale ids). */
const through = (map: Map<string, string>) => (id: string) => map.get(id) ?? id;

const asIds = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function planDuplicate(input: DuplicateInput, newId: () => string = () => crypto.randomUUID()): DuplicatePlan {
  const pageIds = new Map(input.pages.map((p) => [p.id, newId()]));
  const propIds = new Map(input.properties.map((p) => [p.id, newId()]));
  const copiedDatabases = new Set(input.pages.filter((p) => p.kind === "database").map((p) => p.id));
  const propsById = new Map(input.properties.map((p) => [p.id, p]));

  /** Where a relation points after copying: the copy when its target database is copied too. */
  const relationInside = (prop: SourceProperty | undefined) => {
    const target = prop?.type === "relation" ? prop.options.relation?.databaseId : undefined;
    return !!target && copiedDatabases.has(target);
  };

  const properties = input.properties.map((prop): SourceProperty => {
    const options: PropertyOptions = structuredClone(prop.options);
    const relation = prop.type === "relation" ? prop.options.relation : undefined;
    if (relation) {
      options.relation = relationInside(prop)
        ? {
            databaseId: pageIds.get(relation.databaseId)!,
            pairedPropertyId: (relation.pairedPropertyId && propIds.get(relation.pairedPropertyId)) || null,
          }
        : // The target stays the original database, one-way: its paired property keeps pairing with
          // the original, and mirroring into it from the copy would corrupt that pairing.
          { databaseId: relation.databaseId, pairedPropertyId: null };
    }
    return { ...prop, id: propIds.get(prop.id)!, databaseId: pageIds.get(prop.databaseId)!, options };
  });

  const views = input.views.map(
    (view): SourceView => ({
      ...view,
      id: newId(),
      databaseId: pageIds.get(view.databaseId)!,
      config: remapViewConfig(view.config, propIds, (propertyId) =>
        relationInside(propsById.get(propertyId)) ? pageIds : null,
      ),
    }),
  );

  const pages = input.pages.map((p): PlannedPage => {
    const isRoot = p.id === input.rootId;
    // Row values are keyed by the parent database's properties; only rows of copied databases
    // change. The root keeps its values: its parent (if a database) is not copied.
    const rowOfCopy = !isRoot && !!p.parentId && copiedDatabases.has(p.parentId);
    return {
      sourceId: p.id,
      id: pageIds.get(p.id)!,
      parentId: isRoot ? p.parentId : pageIds.get(p.parentId!)!,
      kind: p.kind,
      title: isRoot ? input.rootTitle : p.title,
      position: isRoot ? input.rootPosition : p.position,
      properties: rowOfCopy
        ? remapRowProperties(p.properties, propIds, (propertyId) =>
            relationInside(propsById.get(propertyId)) ? pageIds : null,
          )
        : structuredClone(p.properties),
    };
  });

  return { rootId: pageIds.get(input.rootId)!, pageIds, pages, properties, views };
}

/**
 * Rekeys a row's values to the copied properties. `rowIdsFor(sourcePropertyId)` returns the row id
 * map for relations whose target database was copied (links then point at the copied rows, and
 * links to rows that weren't copied are dropped); null keeps the values as they are.
 */
export function remapRowProperties(
  properties: RowProperties,
  propIds: Map<string, string>,
  rowIdsFor: (sourcePropertyId: string) => Map<string, string> | null,
): RowProperties {
  const out: RowProperties = {};
  for (const [key, value] of Object.entries(properties)) {
    const rowIds = rowIdsFor(key);
    if (!rowIds) {
      out[through(propIds)(key)] = structuredClone(value);
      continue;
    }
    const linked = asIds(value).flatMap((id) => (rowIds.has(id) ? [rowIds.get(id)!] : []));
    if (linked.length) out[through(propIds)(key)] = linked;
  }
  return out;
}

/**
 * Points a view config at the copied properties. Option ids (`groupOrder`, `hiddenGroups`, filter
 * values of selects) stay: options keep their ids when copied. Relation filter values are row ids
 * and follow `rowIdsFor` like row values do.
 */
export function remapViewConfig(
  config: ViewConfig,
  propIds: Map<string, string>,
  rowIdsFor: (sourcePropertyId: string) => Map<string, string> | null,
): ViewConfig {
  const map = through(propIds);
  const out: ViewConfig = structuredClone(config);
  if (config.groupBy !== undefined) out.groupBy = map(config.groupBy);
  if (config.dateBy !== undefined) out.dateBy = map(config.dateBy);
  if (config.endDateBy !== undefined) out.endDateBy = map(config.endDateBy);
  if (config.sorts) out.sorts = config.sorts.map((s) => ({ ...s, propertyId: map(s.propertyId) }));
  if (config.filters) {
    out.filters = mapFilterRules(config.filters, (f) => {
      const rowIds = rowIdsFor(f.propertyId);
      const value = rowIds && typeof f.value === "string" ? (rowIds.get(f.value) ?? f.value) : structuredClone(f.value);
      return { ...f, propertyId: map(f.propertyId), ...(f.value !== undefined ? { value } : {}) };
    });
  }
  if (config.hidden) out.hidden = config.hidden.map(map);
  if (config.shown) out.shown = config.shown.map(map);
  if (config.calculations) {
    out.calculations = Object.fromEntries(Object.entries(config.calculations).map(([key, fn]) => [map(key), fn]));
  }
  return out;
}
