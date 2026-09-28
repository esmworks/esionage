/**
 * Workspace sites (see server/site.ts): addresses and slugs. Pure helpers, shared by the server,
 * the settings form and tests.
 *
 * A site lives at `/s/<slug>` and its pages at `/s/<slug>/<title-slug>-<page id>`. Publication links
 * (`/s/<token>/…`) share the `/s/` prefix: tokens are 43 characters long, slugs at most 40, so a key
 * is always one or the other.
 */

export const SITE_SLUG_MIN = 3;
export const SITE_SLUG_MAX = 40;

const SLUG = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * Slugs that would read as part of the app or pass for someone else's: kept back so a site can't
 * look like an official page of the server.
 */
export const RESERVED_SITE_SLUGS: ReadonlySet<string> = new Set([
  "about",
  "account",
  "admin",
  "api",
  "app",
  "assets",
  "auth",
  "billing",
  "blog",
  "dashboard",
  "docs",
  "download",
  "duplicate",
  "leafdesk",
  "help",
  "home",
  "invite",
  "join",
  "login",
  "logout",
  "mcp",
  "new",
  "oauth",
  "official",
  "public",
  "root",
  "security",
  "settings",
  "sign-in",
  "sign-up",
  "signin",
  "signup",
  "site",
  "sites",
  "static",
  "status",
  "support",
  "system",
  "www",
]);

export type SiteSlugProblem = "tooShort" | "tooLong" | "invalid" | "reserved";

/** Why `slug` can't be a site's slug, or null when it can. Slugs are compared lowercased. */
export function siteSlugProblem(slug: string): SiteSlugProblem | null {
  if (slug.length < SITE_SLUG_MIN) return "tooShort";
  if (slug.length > SITE_SLUG_MAX) return "tooLong";
  if (!SLUG.test(slug) || slug.includes("--")) return "invalid";
  if (RESERVED_SITE_SLUGS.has(slug)) return "reserved";
  return null;
}

/** Whether a `/s/<key>` key names a site (else it is a publication token). */
export const isSiteKey = (key: string) => key.length <= SITE_SLUG_MAX && SLUG.test(key);

/** A slug suggestion from a name: "Ayşe's Notes" → "ayses-notes". May still need checking. */
export function slugify(text: string, max = 60): string {
  const ascii = text
    .toLocaleLowerCase("en")
    .replace(/ı/g, "i")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");
  return ascii
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

const UUID_AT_END = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const PLAIN_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** A site page's path segment: its title as a slug, then its id; just the id for untitled pages. */
export function pageSegment(id: string, title: string): string {
  const words = slugify(title);
  return words ? `${words}-${id}` : id;
}

/** The page id in a site path segment (`<title-slug>-<id>` or a bare id), or null. */
export function pageIdFromSegment(segment: string): string | null {
  let value: string;
  try {
    value = decodeURIComponent(segment);
  } catch {
    return null;
  }
  const uuid = UUID_AT_END.exec(value);
  if (uuid) return uuid[1].toLowerCase();
  return PLAIN_ID.test(value) ? value : null;
}

/**
 * How a published page links to the pages it shows. `base` is `/s/<token>` (a publication link:
 * pages by id) or `/s/<slug>` (a site: pages by title and id); `homeId` is the page `base` opens.
 */
export type PublishedLinks = { base: string; homeId: string; site: boolean };

export function publishedHref(links: PublishedLinks, id: string, title: string): string {
  if (id === links.homeId) return links.base;
  return `${links.base}/${links.site ? pageSegment(id, title) : id}`;
}
