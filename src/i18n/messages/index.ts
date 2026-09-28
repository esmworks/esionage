import { DEFAULT_LOCALE, type Locale } from "../config";
import type en from "./en";

/**
 * The app's texts. English (en.ts) is the source and defines the shape; every other language is a
 * folder of JSON files with the same names and keys (see CONTRIBUTING.md), loaded here by
 * convention, so adding a language needs no code in this file.
 */
export type Messages = typeof en;

/**
 * `translated` laid over `source`: keys a translation lacks (or has as a non-string) keep the
 * source text, so a partly translated language shows English instead of raw keys. Keys the
 * source doesn't have are dropped. `pnpm i18n:check` reports both.
 */
export function withFallback<T>(source: T, translated: unknown): T {
  if (typeof source === "string") return (typeof translated === "string" ? translated : source) as T;
  if (source === null || typeof source !== "object" || Array.isArray(source)) return source;
  const from = translated !== null && typeof translated === "object" ? (translated as Record<string, unknown>) : {};
  return Object.fromEntries(
    Object.entries(source as Record<string, unknown>).map(([key, value]) => [key, withFallback(value, from[key])]),
  ) as T;
}

/** One JSON file of a language (`messages/<locale>/<file>.json`); undefined when it has none. */
export async function loadLocaleFile(locale: Locale, file: string): Promise<unknown> {
  try {
    return (await import(`./${locale}/${file}.json`)).default;
  } catch {
    return undefined;
  }
}

async function loadSource(): Promise<Messages> {
  return (await import("./en")).default;
}

async function load(locale: Locale): Promise<Messages> {
  const source = await loadSource();
  if (locale === DEFAULT_LOCALE) return source;
  // One file per top-level namespace; `import` lives in import.json like the others.
  const namespaces = Object.keys(source) as (keyof Messages)[];
  const files = await Promise.all(namespaces.map((ns) => loadLocaleFile(locale, ns)));
  return withFallback(source, Object.fromEntries(namespaces.map((ns, i) => [ns, files[i]])));
}

// Built once per language in production; in development edits to the JSON files show on reload.
const cache = new Map<Locale, Promise<Messages>>();

export function loadMessages(locale: Locale): Promise<Messages> {
  if (process.env.NODE_ENV !== "production") return load(locale);
  let messages = cache.get(locale);
  if (!messages) cache.set(locale, (messages = load(locale)));
  return messages;
}

/**
 * The messages the browser gets (app/layout): all of them but those only server components render,
 * so every page doesn't carry them. The audit log (settings.audit) is one; a client component
 * that needs its texts would get raw keys, which messages.test.ts guards against.
 */
export function clientMessages(messages: Messages) {
  const { audit: _audit, ...settings } = messages.settings;
  return { ...messages, settings };
}
