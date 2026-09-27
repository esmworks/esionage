import { MENTION, mentionPlainText } from "./mentions";

/** Minimal structural view of BlockNote blocks; enough to extract searchable text. */
type InlineNode = { type: string; text?: string; content?: InlineNode[] | string; props?: unknown };
type TableContent = { type: "tableContent"; rows: { cells: (InlineNode[] | { content: InlineNode[] })[] }[] };
export type BlockLike = {
  type?: string;
  props?: Record<string, unknown>;
  content?: InlineNode[] | TableContent | string;
  children?: BlockLike[];
};

function inlineText(nodes: InlineNode[] | string | undefined): string {
  if (!nodes) return "";
  if (typeof nodes === "string") return nodes;
  // People and dates read as "@Name" and "@2026-10-01"; a page mention adds no text (see lib/mentions).
  return nodes.map((n) => (typeof n.text === "string" ? n.text : n.type === MENTION ? mentionPlainText(n.props) : inlineText(n.content))).join("");
}

function blockText(block: BlockLike): string {
  const { content } = block;
  // A bookmark has no text of its own; its page's title and description are what people search for.
  if (block.type === "bookmark") {
    return [block.props?.title, block.props?.description].filter((v) => typeof v === "string" && v).join(" ");
  }
  if (!content) return "";
  if (typeof content === "string" || Array.isArray(content)) return inlineText(content);
  if (content.type === "tableContent") {
    return content.rows
      .map((row) => row.cells.map((cell) => inlineText(Array.isArray(cell) ? cell : cell.content)).join(" "))
      .join("\n");
  }
  return "";
}

/** Plain text of a block tree, one line per block, for full-text search. */
export function blocksToPlainText(blocks: BlockLike[]): string {
  const lines: string[] = [];
  const walk = (list: BlockLike[]) => {
    for (const block of list) {
      const text = blockText(block).trim();
      if (text) lines.push(text);
      if (block.children?.length) walk(block.children);
    }
  };
  walk(blocks);
  return lines.join("\n");
}
