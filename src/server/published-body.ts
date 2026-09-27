import * as Y from "yjs";
import { blocksToPlainText } from "@/lib/blocks";
import { COLLAB_FRAGMENT } from "@/lib/collab-constants";
import { BREADCRUMB_BLOCK, MERMAID_BLOCK, TOC_BLOCK } from "@/lib/content-blocks";
import { plainText } from "@/lib/content-markdown";
import { isEmbedBlockType, parseLinkedView, type EmbedBlockType, type LinkedView } from "@/lib/embed-blocks";
import { pdfFileId } from "@/lib/files";
import { BOOKMARK_BLOCK, embedFor, isWebBlockType, parseWebUrl, type EmbedTarget } from "@/lib/web-blocks";
import { serverEditor as editor, type PageBlock } from "@/server/blocknote";

/**
 * Turns a stored page body (Yjs state) into HTML for the public, read-only view of a published page.
 *
 * The HTML comes from BlockNote's own serializer (ProseMirror → DOM → string), so text and
 * attribute values are escaped by the DOM serializer; nothing from the document is passed through
 * as raw HTML. Links and media URLs are still whatever an editor typed, so `sanitizeBlocks` keeps
 * only http(s)/mailto links and http(s) or same-origin media before serializing.
 *
 * Database blocks are not serialized: the body comes back as HTML parts with the database blocks
 * between them, and the publication decides for each whether its database may be shown. Tables of
 * contents, breadcrumbs and Mermaid diagrams come back between the parts too, for the page to
 * draw, and so do bookmarks and embeds (an iframe only for an allowlisted provider, see
 * lib/web-blocks), and uploaded PDFs, which the page shows in place. Equations are serialized: KaTeX builds them on the server (see server/blocknote.ts).
 */

type Json = unknown;

const SAFE_LINK = /^(https?:|mailto:)/i;
const SAFE_MEDIA = /^https?:/i;

export function isSafeLink(href: unknown): href is string {
  return typeof href === "string" && SAFE_LINK.test(href.trim());
}

export function isSafeMediaUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  const value = url.trim();
  // Same-origin absolute paths are fine; "//host" is protocol-relative, i.e. another origin.
  return SAFE_MEDIA.test(value) || (value.startsWith("/") && !value.startsWith("//"));
}

/** Inline content: unsafe links become their plain text; everything else is walked. */
function sanitizeInline(items: Json[]): Json[] {
  const out: Json[] = [];
  for (const item of items) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const node = item as Record<string, Json>;
      if (node.type === "link") {
        const content = Array.isArray(node.content) ? sanitizeInline(node.content) : [];
        if (isSafeLink(node.href)) out.push({ ...node, href: String(node.href).trim(), content });
        else out.push(...content);
        continue;
      }
      out.push(sanitizeValue(node));
      continue;
    }
    out.push(item);
  }
  return out;
}

function sanitizeValue(value: Json): Json {
  if (Array.isArray(value)) return sanitizeInline(value);
  if (!value || typeof value !== "object") return value;
  const node = value as Record<string, Json>;
  const next: Record<string, Json> = {};
  for (const [key, child] of Object.entries(node)) {
    if (key === "props" && child && typeof child === "object" && !Array.isArray(child)) {
      const props = { ...(child as Record<string, Json>) };
      if ("url" in props && !isSafeMediaUrl(props.url)) props.url = "";
      next[key] = props;
    } else {
      next[key] = sanitizeValue(child);
    }
  }
  return next;
}

/** A copy of the block tree with unsafe links unwrapped and unsafe media URLs cleared. */
export function sanitizeBlocks<T>(blocks: T[]): T[] {
  return blocks.map((block) => sanitizeValue(block) as T);
}

/**
 * BlockNote's HTML export fills a block without text (an empty line, an empty heading) with an
 * object replacement character, which browsers draw as a box. A line break keeps the empty line.
 */
function emptyLinesAsBreaks(html: string): string {
  return html.replaceAll("\uFFFC", "<br>");
}

/** A heading of the page, for a table of contents: `anchor` is the id its HTML heading carries. */
export type BodyHeading = { anchor: string; level: number; text: string };

/**
 * A run of ordinary blocks as HTML, or a block the page draws itself at that point: a database, a
 * table of contents (with every heading of the page), a breadcrumb or a Mermaid diagram (drawn in
 * the visitor's browser, see components/published).
 */
export type BodySegment =
  | { kind: "html"; html: string }
  | { kind: "embed"; type: EmbedBlockType; databaseId: string; view: LinkedView | null }
  | { kind: "toc"; headings: BodyHeading[] }
  | { kind: "breadcrumb" }
  | { kind: "mermaid"; source: string }
  | { kind: "bookmark"; bookmark: PublishedBookmark }
  /** An embed of an allowlisted provider; any other URL comes back as a bookmark. */
  | { kind: "webEmbed"; url: string; embed: EmbedTarget }
  /** A file block holding an uploaded PDF, shown in place (see components/page/pdf-viewer.tsx). */
  | { kind: "pdf"; fileId: string; name: string; caption: string };

/** A bookmark card's details, every URL checked to be http(s). */
export type PublishedBookmark = { url: string; title: string; description: string; image: string; favicon: string; siteName: string };

/** The uploaded PDF a file block shows in place, if it holds one (see lib/files pdfFileId). */
function pdfOf(block: PageBlock): string | null {
  if (block.type !== "file") return null;
  const props = block.props as { url?: unknown; name?: unknown };
  return pdfFileId(props.url, props.name);
}

const isStandalone = (block: PageBlock) =>
  isEmbedBlockType(block.type) ||
  isWebBlockType(block.type) ||
  block.type === TOC_BLOCK ||
  block.type === BREADCRUMB_BLOCK ||
  block.type === MERMAID_BLOCK ||
  pdfOf(block) !== null;

/** A bookmark or embed block as the published page draws it, or null when it has no valid URL. */
function webSegment(block: PageBlock): BodySegment | null {
  const props = block.props as Record<string, unknown>;
  const url = parseWebUrl(props.url)?.href;
  if (!url) return null;
  if (block.type !== BOOKMARK_BLOCK) {
    const embed = embedFor(url);
    if (embed) return { kind: "webEmbed", url, embed };
  }
  const text = (name: string) => (typeof props[name] === "string" ? (props[name] as string) : "");
  return {
    kind: "bookmark",
    bookmark: {
      url,
      title: text("title"),
      description: text("description"),
      image: parseWebUrl(props.image)?.href ?? "",
      favicon: parseWebUrl(props.favicon)?.href ?? "",
      siteName: text("siteName"),
    },
  };
}

/** A block drawn on its own nested in another block (e.g. under a list item) is shown after that block. */
function withoutNestedStandalone(block: PageBlock, found: PageBlock[]): PageBlock {
  if (!block.children?.length) return block;
  const children: PageBlock[] = [];
  for (const child of block.children) {
    if (isStandalone(child)) found.push(child);
    else children.push(withoutNestedStandalone(child, found));
  }
  return { ...block, children } as PageBlock;
}

/** Headings of a run of blocks in the order its HTML has them (each block, then its children). */
function runHeadings(blocks: PageBlock[], out: PageBlock[] = []): PageBlock[] {
  for (const block of blocks) {
    if (block.type === "heading") out.push(block);
    if (block.children?.length) runHeadings(block.children, out);
  }
  return out;
}

export async function bodySegmentsFromYdoc(state: Uint8Array | null): Promise<BodySegment[]> {
  if (!state || state.byteLength === 0) return [];
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    const blocks = editor.yXmlFragmentToBlocks(doc.getXmlFragment(COLLAB_FRAGMENT));
    const segments: BodySegment[] = [];
    // Every heading of the page, filled in as the runs are written; tables of contents share it.
    const headings: BodyHeading[] = [];
    let run: PageBlock[] = [];
    const flush = async () => {
      if (!run.length) return;
      const inRun = runHeadings(run).map((block) => {
        const heading = {
          anchor: `heading-${headings.length + 1}`,
          level: Number((block.props as { level?: unknown }).level) || 1,
          text: blocksToPlainText([{ ...block, children: [] }]),
        };
        headings.push(heading);
        return heading;
      });
      let html = emptyLinesAsBreaks(await editor.blocksToHTMLLossy(sanitizeBlocks(run)));
      run = [];
      // The serializer escapes text, so "<h2" only ever starts a heading: the n-th one is the
      // run's n-th heading block. The anchors are ours ("heading-3"), nothing from the document.
      let n = 0;
      html = html.replace(/<h([1-6])(?=[\s>])/g, (tag, level: string) => {
        const heading = inRun[n++];
        return heading ? `<h${level} id="${heading.anchor}"` : tag;
      });
      if (html) segments.push({ kind: "html", html });
    };
    const standalone = async (block: PageBlock) => {
      if (block.type === TOC_BLOCK || block.type === BREADCRUMB_BLOCK) {
        await flush();
        segments.push(block.type === TOC_BLOCK ? { kind: "toc", headings } : { kind: "breadcrumb" });
        return;
      }
      if (isWebBlockType(block.type)) {
        const segment = webSegment(block);
        if (!segment) return;
        await flush();
        segments.push(segment);
        return;
      }
      const pdf = pdfOf(block);
      if (pdf) {
        const props = block.props as { name?: unknown; caption?: unknown };
        await flush();
        segments.push({
          kind: "pdf",
          fileId: pdf,
          name: typeof props.name === "string" ? props.name : "",
          caption: typeof props.caption === "string" ? props.caption : "",
        });
        return;
      }
      if (block.type === MERMAID_BLOCK) {
        const source = plainText(block.content);
        if (!source.trim()) return;
        await flush();
        segments.push({ kind: "mermaid", source });
        return;
      }
      const props = block.props as { databaseId?: unknown; view?: unknown };
      if (typeof props.databaseId !== "string" || !props.databaseId || !isEmbedBlockType(block.type)) return;
      await flush();
      segments.push({
        kind: "embed",
        type: block.type,
        databaseId: props.databaseId,
        view: block.type === "linkedView" ? parseLinkedView(props.view) : null,
      });
    };
    for (const block of blocks) {
      if (isStandalone(block)) {
        await standalone(block);
        continue;
      }
      const nested: PageBlock[] = [];
      run.push(withoutNestedStandalone(block, nested));
      for (const inner of nested) await standalone(inner);
    }
    await flush();
    return segments;
  } finally {
    doc.destroy();
  }
}

/** The body as one HTML string, leaving database blocks out. */
export async function bodyHtmlFromYdoc(state: Uint8Array | null): Promise<string> {
  const segments = await bodySegmentsFromYdoc(state);
  return segments.map((s) => (s.kind === "html" ? s.html : "")).join("");
}
