export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** Deliberately loose: one @, something on both sides, a dot in the domain, no spaces. */
export const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

/** How many people one "Add members" request may add. */
export const MAX_BULK_EMAILS = 50;

/** Splits pasted text (commas, semicolons, spaces, new lines) into unique lowercased addresses. */
export function parseEmailList(input: string): string[] {
  return [...new Set(input.split(/[\s,;]+/).map(normalizeEmail).filter(Boolean))];
}
