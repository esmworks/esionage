// Client-safe: no imports, so UI code can use these without pulling in the database schema.
export const PROPERTY_TYPES = ["text", "number", "select", "multi_select", "date", "checkbox", "url"] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];
