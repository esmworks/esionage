import { randomBytes } from "node:crypto";
import {
  BlockNoteSchema,
  createBlockSpec,
  createExtension,
  createInlineContentSpec,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  type PartialBlock,
} from "@blocknote/core";
import { CommentMark } from "@blocknote/core/comments";
import { ServerBlockNoteEditor } from "@blocknote/server-util";
import katex from "katex";
import {
  breadcrumbBlockConfig,
  calloutBlockConfig,
  inlineMathConfig,
  KATEX_OPTIONS,
  mathBlockConfig,
  mermaidBlockConfig,
  tocBlockConfig,
} from "@/lib/content-blocks";
import { finishMarkdownImport, plainText, prepareMarkdownExport, prepareMarkdownImport } from "@/lib/content-markdown";
import {
  databaseBlockConfig,
  linkedViewBlockConfig,
  mergeReferencedBlocks,
  referenceLine,
  splitMarkdownReferences,
  isEmbedBlockType,
} from "@/lib/embed-blocks";

/**
 * The page body schema on the server: BlockNote's blocks plus the database blocks and the content
 * blocks (lib/content-blocks), so reading and writing documents (derived Markdown and text, MCP
 * writes, history restores, published pages) understands every block the editor can insert. The
 * editor's schema (components/page/embed-blocks.tsx) uses the same configs with React rendering.
 */

/** Server rendering of a database block: never the database itself, only a neutral marker. */
const marker = (type: string) => ({
  render: () => {
    const dom = document.createElement("div");
    dom.setAttribute("data-esionage-embed", type);
    return { dom };
  },
});

/**
 * An equation as KaTeX builds it: DOM nodes made one by one (no HTML string is parsed), from a
 * source KaTeX escapes, with `trust: false` so no link, image or HTML command gets through. A
 * malformed source shows as KaTeX's error text instead of failing the page.
 */
function mathElement(tag: "div" | "span", latex: string, displayMode: boolean) {
  const dom = document.createElement(tag);
  dom.setAttribute("data-esionage-math", displayMode ? "block" : "inline");
  if (latex.trim()) katex.render(latex, dom, { ...KATEX_OPTIONS, displayMode, throwOnError: false });
  return dom;
}

/** A "plain" block's source, as the server editor lays it out. */
function sourceElement(kind: string) {
  const dom = document.createElement("pre");
  dom.setAttribute(`data-esionage-${kind}`, "");
  const code = document.createElement("code");
  dom.appendChild(code);
  return { dom, contentDOM: code };
}

const contentBlockSpecs = {
  callout: createBlockSpec(calloutBlockConfig, {
    render: (block) => {
      const dom = document.createElement("div");
      dom.setAttribute("data-esionage-callout", "");
      if (block.props.icon) {
        const icon = document.createElement("span");
        icon.setAttribute("data-callout-icon", "");
        icon.textContent = block.props.icon;
        dom.appendChild(icon);
      }
      const contentDOM = document.createElement("div");
      contentDOM.setAttribute("data-callout-text", "");
      dom.appendChild(contentDOM);
      return { dom, contentDOM };
    },
  })(),
  math: createBlockSpec(mathBlockConfig, {
    meta: { code: true },
    render: () => sourceElement("math"),
    toExternalHTML: (block) => ({ dom: mathElement("div", plainText(block.content), true) }),
  })(),
  // Published pages draw diagrams in the browser (see published-body.ts); elsewhere the source.
  mermaid: createBlockSpec(mermaidBlockConfig, {
    meta: { code: true },
    render: () => sourceElement("mermaid"),
    toExternalHTML: (block) => {
      const { dom, contentDOM } = sourceElement("mermaid");
      contentDOM.className = "language-mermaid";
      contentDOM.textContent = plainText(block.content);
      return { dom };
    },
  })(),
  tableOfContents: createBlockSpec(tocBlockConfig, marker("tableOfContents"))(),
  breadcrumb: createBlockSpec(breadcrumbBlockConfig, marker("breadcrumb"))(),
};

const inlineMath = createInlineContentSpec(inlineMathConfig, {
  meta: { code: true },
  render: () => {
    const dom = document.createElement("span");
    dom.setAttribute("data-esionage-math", "inline");
    return { dom, contentDOM: dom };
  },
  toExternalHTML: (inlineContent) => ({ dom: mathElement("span", plainText(inlineContent.content), false) }),
});

export const pageSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    database: createBlockSpec(databaseBlockConfig, marker("database"))(),
    linkedView: createBlockSpec(linkedViewBlockConfig, marker("linkedView"))(),
    ...contentBlockSpecs,
  },
  inlineContentSpecs: { ...defaultInlineContentSpecs, inlineMath },
});

/**
 * Comments mark the text they're about. Without the mark in the schema, text carrying it would read
 * as empty (and writes would drop it), so the server knows it even though it never shows comments.
 */
const commentMarks = createExtension({ key: "commentMarks", tiptapExtensions: [CommentMark] });

export const serverEditor = ServerBlockNoteEditor.create({ schema: pageSchema, extensions: [commentMarks] });

export type PageBlock = ReturnType<typeof serverEditor.yXmlFragmentToBlocks>[number];
type PartialPageBlock = PartialBlock<typeof pageSchema.blockSchema, typeof pageSchema.inlineContentSchema, typeof pageSchema.styleSchema>;

/**
 * Markdown of a page body. Database blocks become their reference line (see lib/embed-blocks):
 * each is written as a paragraph holding a one-off token, which the Markdown serializer leaves as
 * it is, and the token is swapped for the line afterwards. Content blocks take their Markdown
 * forms the same way (see lib/content-markdown).
 */
export async function blocksToMarkdown(blocks: PageBlock[]): Promise<string> {
  const nonce = randomBytes(6).toString("hex");
  const content = prepareMarkdownExport(blocks, nonce);
  const lines: string[] = [];
  const replace = (list: PageBlock[]): PartialPageBlock[] =>
    list.flatMap((block): PartialPageBlock[] => {
      const children = block.children?.length ? replace(block.children) : [];
      if (!isEmbedBlockType(block.type)) return [{ ...block, children } as PartialPageBlock];
      const databaseId = String((block.props as { databaseId?: unknown }).databaseId ?? "");
      // Not pointed at a database yet: nothing to write.
      if (!databaseId) return children;
      lines.push(referenceLine(block.type, databaseId));
      return [{ type: "paragraph", content: `esionage${nonce}embed${lines.length - 1}x`, children }];
    });
  const markdown = content.finish(await serverEditor.blocksToMarkdownLossy(replace(content.blocks)));
  return markdown.replace(new RegExp(`esionage${nonce}embed(\\d+)x`, "g"), (_, i: string) => lines[Number(i)] ?? "");
}

/** Blocks for Markdown, with the content blocks' Markdown forms (see lib/content-markdown). */
async function parseMarkdown(markdown: string): Promise<PageBlock[]> {
  const nonce = randomBytes(6).toString("hex");
  const prepared = prepareMarkdownImport(markdown, nonce);
  const blocks = (await serverEditor.tryParseMarkdownToBlocks(prepared.markdown)) as PageBlock[];
  return finishMarkdownImport(blocks, prepared, nonce, parseMarkdown);
}

/**
 * Blocks for Markdown written into a page (MCP, new pages), given the page's current blocks.
 * Reference lines become database blocks; see mergeReferencedBlocks for what carries over.
 */
export async function markdownToBlocks(
  markdown: string,
  existing: PageBlock[] = [],
  { keepMissingInline = true }: { keepMissingInline?: boolean } = {},
): Promise<PageBlock[]> {
  const parts = await Promise.all(
    splitMarkdownReferences(markdown).map(async (part) =>
      "markdown" in part ? { blocks: await parseMarkdown(part.markdown) } : part,
    ),
  );
  return mergeReferencedBlocks(parts, existing, { keepMissingInline });
}
