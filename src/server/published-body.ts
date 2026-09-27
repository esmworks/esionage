import * as Y from "yjs";
import { COLLAB_FRAGMENT } from "@/lib/collab-constants";
import { isEmbedBlockType, parseLinkedView, type EmbedBlockType, type LinkedView } from "@/lib/embed-blocks";
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
 * between them, and the publication decides for each whether its database may be shown.
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

/** A run of ordinary blocks as HTML, or a database block the page shows at that point. */
export type BodySegment =
  | { kind: "html"; html: string }
  | { kind: "embed"; type: EmbedBlockType; databaseId: string; view: LinkedView | null };

/** A database block nested in another block (e.g. under a list item) is shown after that block. */
function withoutNestedEmbeds(block: PageBlock, found: PageBlock[]): PageBlock {
  if (!block.children?.length) return block;
  const children: PageBlock[] = [];
  for (const child of block.children) {
    if (isEmbedBlockType(child.type)) found.push(child);
    else children.push(withoutNestedEmbeds(child, found));
  }
  return { ...block, children } as PageBlock;
}

export async function bodySegmentsFromYdoc(state: Uint8Array | null): Promise<BodySegment[]> {
  if (!state || state.byteLength === 0) return [];
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    const blocks = editor.yXmlFragmentToBlocks(doc.getXmlFragment(COLLAB_FRAGMENT));
    const segments: BodySegment[] = [];
    let run: PageBlock[] = [];
    const flush = async () => {
      if (!run.length) return;
      const html = emptyLinesAsBreaks(await editor.blocksToHTMLLossy(sanitizeBlocks(run)));
      run = [];
      if (html) segments.push({ kind: "html", html });
    };
    const embed = async (block: PageBlock) => {
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
      if (isEmbedBlockType(block.type)) {
        await embed(block);
        continue;
      }
      const nested: PageBlock[] = [];
      run.push(withoutNestedEmbeds(block, nested));
      for (const inner of nested) await embed(inner);
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
