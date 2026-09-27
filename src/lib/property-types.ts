// Client-safe: no imports, so UI code can use these without pulling in the database schema.
export const PROPERTY_TYPES = ["text", "number", "select", "multi_select", "date", "checkbox", "url", "relation", "person"] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

/**
 * Stored in a person filter's value instead of a user id: whoever is looking at the view, so one
 * saved "Assignee contains me" view shows each person their own rows.
 */
export const PERSON_ME = "me";
