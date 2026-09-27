// Client-safe: no imports, so UI code can use these without pulling in the database schema.
export const PROPERTY_TYPES = [
  "text",
  "number",
  "select",
  "multi_select",
  "status",
  "date",
  "checkbox",
  "url",
  "email",
  "phone",
  "checklist",
  "relation",
  "person",
  "created_by",
  "created_time",
  "last_edited_by",
  "last_edited_time",
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

/**
 * Stored in a person filter's value instead of a user id: whoever is looking at the view, so one
 * saved "Assignee contains me" view shows each person their own rows.
 */
export const PERSON_ME = "me";

/**
 * Types whose values are lists of user ids: people picked by hand, or whoever created or last
 * edited the row.
 */
export function holdsPeople(type: string) {
  return type === "person" || type === "created_by" || type === "last_edited_by";
}

/** Types Esionage fills in from the row itself (who and when): never stored, never written. */
export function isComputed(type: string) {
  return type === "created_by" || type === "created_time" || type === "last_edited_by" || type === "last_edited_time";
}

/** Types whose values are points in time (ISO timestamps), filtered by day like dates. */
export function holdsTimestamp(type: string) {
  return type === "created_time" || type === "last_edited_time";
}

/** Types whose values are ids of the property's options. */
export function holdsOptions(type: string) {
  return type === "select" || type === "multi_select" || type === "status";
}

/**
 * The stages every status option belongs to, in order. Boards and sorts follow this order, and
 * the option editor lists options under them.
 */
export const STATUS_GROUPS = ["todo", "in_progress", "done"] as const;
export type StatusGroup = (typeof STATUS_GROUPS)[number];
