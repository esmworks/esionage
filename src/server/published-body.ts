import * as Y from "yjs";
import { blocksToPlainText } from "@/lib/blocks";
import { COLLAB_FRAGMENT } from "@/lib/collab-constants";
import { BREADCRUMB_BLOCK, MERMAID_BLOCK, TOC_BLOCK } from "@/lib/content-blocks";
import { plainText } from "@/lib/content-markdown";
import { isEmbedBlockType, parseLinkedView, type EmbedBlockType, type LinkedView } from "@/lib/embed-blocks";
import { bodyReferences, MENTION, mentionPlainText, mentionProps, PAGE_LINK_BLOCK } from "@/lib/mentions";
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
 * draw. Equations are serialized: KaTeX builds them on the server (see server/blocknote.ts).
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
 * How a published page shows a page it mentions or links to: `text` (its title, or a note that
 * names nothing) and, when that page is published too, where it is. The publication decides (see
 * server/publication.ts); without a decision a page is left out.
 */
export type PublishedPageRef = { text: string; href: string | null };

const textNode = (text: string) => ({ type: "text", text, styles: {} });

function pageRefInline(ref: PublishedPageRef | undefined): Json[] {
  if (!ref) return [];
  return ref.href ? [{ type: "link", href: ref.href, content: [textNode(ref.text)] }] : [textNode(ref.text)];
}

function resolveInline(content: Json, refs: Map<string, PublishedPageRef>): Json {
  if (Array.isArray(content)) {
    return content.flatMap((item): Json[] => {
      const node = item as Record<string, Json> | null;
      if (node?.type !== MENTION) return [item];
      const props = mentionProps(node.props);
      if (props.kind === "page") return pageRefInline(refs.get(props.pageId));
      return [textNode(mentionPlainText(props))];
    });
  }
  const table = content as { type?: string; rows?: { cells?: Json[] }[] } | null;
  if (table?.type === "tableContent" && Array.isArray(table.rows)) {
    return {
      ...table,
      rows: table.rows.map((row) => ({
        ...row,
        cells: (row.cells ?? []).map((cell) =>
          Array.isArray(cell) ? resolveInline(cell, refs) : cell && typeof cell === "object" ? { ...cell, content: resolveInline((cell as { content?: Json }).content, refs) } : cell,
        ),
      })),
    };
  }
  return content;
}

/**
 * Mentions as plain text or links, and "Link to page" blocks as a line holding one, as `refs`
 * allows (runs after sanitizeBlocks: these links are the publication's own).
 */
function resolveMentions(blocks: PageBlock[], refs: Map<string, PublishedPageRef>): PageBlock[] {
  return blocks.map((block) => {
    const children = block.children?.length ? resolveMentions(block.children, refs) : block.children;
    if (block.type === PAGE_LINK_BLOCK) {
      const pageId = String((block.props as { pageId?: unknown }).pageId ?? "");
      return { id: block.id, type: "paragraph", props: {}, content: pageRefInline(refs.get(pageId)), children } as unknown as PageBlock;
    }
    return { ...block, content: resolveInline(block.content as Json, refs), children } as PageBlock;
  });
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
  | { kind: "mermaid"; source: string };

const isStandalone = (type: string) =>
  isEmbedBlockType(type) || type === TOC_BLOCK || type === BREADCRUMB_BLOCK || type === MERMAID_BLOCK;

/** A block drawn on its own nested in another block (e.g. under a list item) is shown after that block. */
function withoutNestedStandalone(block: PageBlock, found: PageBlock[]): PageBlock {
  if (!block.children?.length) return block;
  const children: PageBlock[] = [];
  for (const child of block.children) {
    if (isStandalone(child.type)) found.push(child);
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

export async function bodySegmentsFromYdoc(
  state: Uint8Array | null,
  /** How to show the pages the body mentions or links to; without it they are left out. */
  { resolvePages }: { resolvePages?: (pageIds: string[]) => Promise<Map<string, PublishedPageRef>> } = {},
): Promise<BodySegment[]> {
  if (!state || state.byteLength === 0) return [];
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    const blocks = editor.yXmlFragmentToBlocks(doc.getXmlFragment(COLLAB_FRAGMENT));
    const { pageIds } = bodyReferences(blocks);
    const refs = pageIds.length && resolvePages ? await resolvePages(pageIds) : new Map<string, PublishedPageRef>();
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
      let html = emptyLinesAsBreaks(await editor.blocksToHTMLLossy(resolveMentions(sanitizeBlocks(run), refs)));
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
      if (isStandalone(block.type)) {
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
