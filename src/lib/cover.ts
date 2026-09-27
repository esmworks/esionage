import * as Y from "yjs";

/** Longer URLs (inline data URLs above all) are not worth sending with every row. */
export const MAX_COVER_URL_LENGTH = 2048;

/** Cover images load straight into the app: http(s) or same-origin paths only, no data or script URLs. */
export function isCoverUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  const value = url.trim();
  if (!value || value.length > MAX_COVER_URL_LENGTH) return false;
  return /^https?:\/\/[^\s]+$/i.test(value) || (value.startsWith("/") && !value.startsWith("//") && !/\s/.test(value));
}

/**
 * The URL of the first image block in a BlockNote document, in reading order (nested blocks
 * included), or null. Walks the Yjs XML directly: much cheaper than converting to blocks. Images
 * with an unusable URL are skipped.
 */
export function firstImageInFragment(fragment: Y.XmlFragment | Y.XmlElement): string | null {
  for (const child of fragment.toArray()) {
    if (!(child instanceof Y.XmlElement)) continue;
    if (child.nodeName === "image") {
      const url = child.getAttribute("url");
      if (isCoverUrl(url)) return url.trim();
      continue;
    }
    const found = firstImageInFragment(child);
    if (found) return found;
  }
  return null;
}

/** First image of a stored Yjs state (`page.ydoc`). */
export function firstImageInYdoc(state: Uint8Array | null | undefined, fragmentName: string): string | null {
  if (!state?.length) return null;
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    return firstImageInFragment(doc.getXmlFragment(fragmentName));
  } finally {
    doc.destroy();
  }
}

/**
 * The first image as it appears in a page's derived Markdown (`![alt](url)`, or `<img …>` for
 * images with a caption). Only a hint: text that merely looks like image Markdown matches too, so
 * it is used to skip rows without images and to notice that a body's images changed, never as
 * the cover itself.
 */
export const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*\]\([^)]*\)|<img [^>]*>/;
/** The same pattern in Postgres regex syntax; `substring(… from …)` returns the outer group. */
export const PG_MARKDOWN_IMAGE_PATTERN = "(!\\[[^]]*\\]\\([^)]*\\)|<img [^>]*>)";

export function markdownImageHint(markdown: string): string | null {
  return MARKDOWN_IMAGE_PATTERN.exec(markdown)?.[0] ?? null;
}
