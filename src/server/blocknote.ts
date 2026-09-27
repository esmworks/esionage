import { randomBytes } from "node:crypto";
import { BlockNoteSchema, createBlockSpec, createExtension, defaultBlockSpecs, type PartialBlock } from "@blocknote/core";
import { CommentMark } from "@blocknote/core/comments";
import { ServerBlockNoteEditor } from "@blocknote/server-util";
import {
  databaseBlockConfig,
  linkedViewBlockConfig,
  mergeReferencedBlocks,
  referenceLine,
  splitMarkdownReferences,
  isEmbedBlockType,
} from "@/lib/embed-blocks";

/**
 * The page body schema on the server: BlockNote's blocks plus the database blocks, so reading and
 * writing documents (derived Markdown and text, MCP writes, history restores, published pages)
 * understands every block the editor can insert. The editor's schema (components/page/
 * embed-blocks.tsx) uses the same block configs with React rendering.
 */

/** Server rendering of a database block: never the database itself, only a neutral marker. */
const marker = (type: string) => ({
  render: () => {
    const dom = document.createElement("div");
    dom.setAttribute("data-esionage-embed", type);
    return { dom };
  },
});

export const pageSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    database: createBlockSpec(databaseBlockConfig, marker("database"))(),
    linkedView: createBlockSpec(linkedViewBlockConfig, marker("linkedView"))(),
  },
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
 * it is, and the token is swapped for the line afterwards.
 */
export async function blocksToMarkdown(blocks: PageBlock[]): Promise<string> {
  const nonce = randomBytes(6).toString("hex");
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
  const markdown = await serverEditor.blocksToMarkdownLossy(replace(blocks));
  return markdown.replace(new RegExp(`esionage${nonce}embed(\\d+)x`, "g"), (_, i: string) => lines[Number(i)] ?? "");
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
      "markdown" in part ? { blocks: await serverEditor.tryParseMarkdownToBlocks(part.markdown) } : part,
    ),
  );
  return mergeReferencedBlocks(parts, existing, { keepMissingInline });
}
