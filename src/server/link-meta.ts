/**
 * Reads a web page's title, description, preview image, icon and site name from the `<head>` of
 * its HTML: Open Graph first, then Twitter cards, then plain `<title>` and `<meta name=…>`. Pure and
 * forgiving: the HTML comes from anywhere, so this scans tags with bounded regular expressions
 * instead of building a DOM, and every value is decoded, trimmed, shortened and (for URLs) resolved
 * against the page and limited to http(s).
 */

export type LinkMeta = {
  title: string;
  description: string;
  image: string;
  favicon: string;
  siteName: string;
};

const MAX_TITLE = 300;
const MAX_DESCRIPTION = 600;
const MAX_SITE_NAME = 120;
const MAX_URL = 2048;

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  laquo: "«",
  raquo: "»",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  middot: "·",
  bull: "•",
  copy: "©",
  reg: "®",
  trade: "™",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (entity, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return entity;
      return String.fromCodePoint(code);
    }
    return NAMED[body.toLowerCase()] ?? entity;
  });
}

/** Collapses whitespace, drops control characters and cuts to `max` characters. */
function clean(text: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  const value = decodeEntities(text).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (value.length <= max) return value;
  return `${[...value].slice(0, max - 1).join("").trimEnd()}…`;
}

/** Attributes of one tag's source (`<meta a="b" c='d' e=f>`), names lowercased. */
export function tagAttributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const attr = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  // Skip the tag name.
  const body = tag.replace(/^<\s*[a-z]+/i, "").replace(/\/?>$/, "");
  for (const match of body.matchAll(attr)) {
    const name = match[1].toLowerCase();
    if (!(name in out)) out[name] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return out;
}

/** The part of the document before `<body>` (or `</head>`), with comments and scripts removed. */
export function headOf(html: string): string {
  const end = html.search(/<\/head\s*>|<body[\s>]/i);
  const head = end >= 0 ? html.slice(0, end) : html;
  return head
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<(script|style|noscript|template)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, "");
}

/** An absolute http(s) URL for `value` on the page at `base`, or "". */
function absoluteUrl(value: string | undefined, base: string): string {
  if (!value) return "";
  const text = decodeEntities(value).trim();
  if (!text || text.length > MAX_URL) return "";
  try {
    const url = new URL(text, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (url.username || url.password) return "";
    return url.href.length > MAX_URL ? "" : url.href;
  } catch {
    return "";
  }
}

/** The charset a `<meta>` of the head declares, if any. */
export function declaredCharset(head: string): string | null {
  for (const match of head.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = tagAttributes(match[0]);
    if (attrs.charset) return attrs.charset.trim().toLowerCase();
    if (attrs["http-equiv"]?.toLowerCase() === "content-type" && attrs.content) {
      const found = /charset\s*=\s*["']?([\w-]+)/i.exec(attrs.content);
      if (found) return found[1].toLowerCase();
    }
  }
  return null;
}

/**
 * The details of the page whose HTML is `html`, fetched from `pageUrl` (the final URL after
 * redirects, which relative URLs are resolved against, or the page's `<base href>`).
 */
export function parseLinkMeta(html: string, pageUrl: string): LinkMeta {
  const head = headOf(html);
  const meta = new Map<string, string>();
  let base = pageUrl;
  const icons: { href: string; rank: number }[] = [];

  for (const match of head.matchAll(/<(meta|link|base)\b[^>]*>/gi)) {
    const tag = match[1].toLowerCase();
    const attrs = tagAttributes(match[0]);
    if (tag === "meta") {
      const key = (attrs.property ?? attrs.name ?? attrs.itemprop ?? "").trim().toLowerCase();
      if (key && attrs.content !== undefined && !meta.has(key)) meta.set(key, attrs.content);
    } else if (tag === "base") {
      const href = absoluteUrl(attrs.href, pageUrl);
      if (href) base = href;
    } else {
      const rel = (attrs.rel ?? "").toLowerCase().split(/\s+/);
      if (!attrs.href) continue;
      // Prefer a plain icon (small, meant for a tab) over touch icons (large), SVG last resort.
      if (rel.includes("icon")) icons.push({ href: attrs.href, rank: attrs.type === "image/svg+xml" ? 1 : 0 });
      else if (rel.includes("apple-touch-icon") || rel.includes("apple-touch-icon-precomposed")) icons.push({ href: attrs.href, rank: 2 });
    }
  }

  const first = (...keys: string[]) => {
    for (const key of keys) {
      const value = meta.get(key);
      if (value && value.trim()) return value;
    }
    return "";
  };
  const titleTag = /<title\b[^>]*>([\s\S]{0,2000}?)<\/title\s*>/i.exec(head)?.[1] ?? "";

  const icon = icons.sort((a, b) => a.rank - b.rank).map((i) => absoluteUrl(i.href, base)).find(Boolean);
  let favicon = icon ?? "";
  if (!favicon) {
    try {
      favicon = new URL("/favicon.ico", pageUrl).href;
    } catch {
      favicon = "";
    }
  }

  return {
    title: clean(first("og:title", "twitter:title") || titleTag || first("title"), MAX_TITLE),
    description: clean(first("og:description", "twitter:description", "description"), MAX_DESCRIPTION),
    image: absoluteUrl(first("og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"), base),
    favicon,
    siteName: clean(first("og:site_name", "application-name"), MAX_SITE_NAME),
  };
}
