export const LOCALES = ["en", "tr"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** Chosen language; absent means "follow the browser". */
export const LOCALE_COOKIE = "NEXT_LOCALE";
/** Browser time zone, so server-rendered dates match the viewer's clock. */
export const TIME_ZONE_COOKIE = "TZ";

export const LOCALE_NAMES: Record<Locale, string> = { en: "English", tr: "Türkçe" };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Picks the best supported locale from an Accept-Language header. */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale {
  const ranked = (acceptLanguage ?? "")
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      return { tag: tag.toLowerCase(), q: q ? Number(q.slice(2)) || 0 : 1 };
    })
    .filter((entry) => entry.tag && entry.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of ranked) {
    const base = tag.split("-")[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

/** The language of a request outside Next's request scope: the saved choice, else Accept-Language. */
export function requestLocale(headers: Headers): Locale {
  const saved = headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim().split("="))
    .find(([name]) => name === LOCALE_COOKIE)?.[1];
  return isLocale(saved) ? saved : negotiateLocale(headers.get("accept-language"));
}
