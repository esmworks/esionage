import {
  ALERT_KINDS,
  alertKindForColor,
  BREADCRUMB_BLOCK,
  CALLOUT_BLOCK,
  colorForAlertKind,
  INLINE_MATH,
  leadingEmoji,
  MATH_BLOCK,
  MERMAID_BLOCK,
  TOC_BLOCK,
  type AlertKind,
} from "./content-blocks";
import { BOOKMARK_BLOCK, markdownLinkDestination, markdownLinkText, parseWebUrl, WEB_EMBED_BLOCK } from "./web-blocks";
import {
  EMPTY_MENTION,
  linkedPageId,
  MENTION,
  mentionProps,
  mentionText,
  PAGE_LINK_BLOCK,
  PAGE_LINK_MARKER,
  pageLinkMarkdown,
  splitMentionText,
  type MentionPerson,
} from "./mentions";

/**
 * The Markdown form of the content blocks (see lib/content-blocks), on top of what BlockNote's own
 * Markdown converters understand:
 *
 *   > [!NOTE]              a callout: a GitHub alert, the kind picks the color and a
 *   > 💡 Text              leading emoji is the icon
 *
 *   $$                     a display equation
 *   \int_0^1 x\,dx
 *   $$
 *
 *   Text with $e^{i\pi}$   an inline equation (Pandoc's rules: no space inside the dollars, and
 *                          no digit right after the closing one, so "$5 and $10" stays text)
 *
 *   ```mermaid             a Mermaid diagram
 *   graph TD; A-->B
 *   ```
 *
 *   <!-- esionage:toc -->         a table of contents
 *   <!-- esionage:breadcrumb -->  a breadcrumb
 *
 *   [Title](https://…)                              a bookmark (reads back as a link, see
 *                                                   lib/web-blocks restoreBookmarks)
 *   [https://…](https://…) <!-- esionage:embed -->  an embed
 * and mentions and page links (see lib/mentions for their forms).
 *
 * BlockNote would mangle the sources (Markdown escapes and emphasis inside LaTeX, KaTeX markup
 * written out as text), so these blocks never go through its converters as themselves: on the way
 * out each becomes a one-off token that the serializer leaves alone and that is swapped for the
 * Markdown afterwards; on the way in the Markdown is swapped for tokens before parsing and the
 * tokens for blocks after.
 */

/** The part of a BlockNote block these helpers read and write. */
export type MdBlock = { type: string; props?: Record<string, unknown>; content?: unknown; children?: MdBlock[] };
type Inline = { type: string; text?: string; content?: unknown; styles?: Record<string, unknown>; href?: string };

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Text of a "plain" block (its content is styled text without styles) or inline node (a string). */
export function plainText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((n: Inline) => (typeof n?.text === "string" ? n.text : plainText(n?.content))).join("");
}

// ---------------------------------------------------------------------------------------------
// Export

const TOKEN_LINE = (nonce: string) => new RegExp(`^([ \\t]*)esionage${nonce}b(\\d+)x[ \\t]*$`, "gm");

/**
 * Prepares blocks for BlockNote's Markdown serializer: returns blocks it can write and a function
 * that turns what it wrote into the final Markdown.
 */
export function prepareMarkdownExport<B extends MdBlock>(
  blocks: B[],
  nonce: string,
  /** The page's workspace, for the links page mentions are written as. */
  { workspaceId = "-" }: { workspaceId?: string } = {},
) {
  const blockMarkdown: string[] = [];
  const inlineMarkdown: string[] = [];
  const callouts: { kind: AlertKind; icon: string }[] = [];
  const blockToken = (markdown: string) => `esionage${nonce}b${blockMarkdown.push(markdown) - 1}x`;
  const dollarToken = `esionage${nonce}dx`;

  const inline = (content: unknown): unknown => {
    if (!Array.isArray(content)) {
      // Tables: rows of cells, each inline content (or a cell object holding it).
      if (isObject(content) && content.type === "tableContent" && Array.isArray(content.rows)) {
        return {
          ...content,
          rows: content.rows.map((row: { cells?: unknown[] }) => ({
            ...row,
            cells: (row.cells ?? []).map((cell) =>
              Array.isArray(cell) ? inline(cell) : isObject(cell) ? { ...cell, content: inline(cell.content) } : cell,
            ),
          })),
        };
      }
      return content;
    }
    return content.map((node: Inline) => {
      // A dollar sign in text is written "\$", or the text would come back as an equation (code
      // spans keep theirs: nothing is an escape inside them).
      if (node?.type === "text" && typeof node.text === "string" && node.text.includes("$") && !node.styles?.code) {
        return { ...node, text: node.text.replaceAll("$", dollarToken) };
      }
      if (node?.type === "link") return { ...node, content: inline(node.content) };
      if (node?.type === MENTION) {
        const props = mentionProps((node as { props?: unknown }).props);
        const markdown =
          props.kind === "page" ? (props.pageId ? pageLinkMarkdown("page", workspaceId, props.pageId) : "") : mentionText(props);
        return { type: "text", text: `esionage${nonce}i${inlineMarkdown.push(markdown) - 1}x`, styles: {} };
      }
      if (node?.type !== INLINE_MATH) return node;
      // $…$ can't span lines; an empty equation writes nothing.
      const latex = plainText(node.content).replace(/\s*\n\s*/g, " ").trim();
      const token = `esionage${nonce}i${inlineMarkdown.push(latex ? `$${latex}$` : "") - 1}x`;
      return { type: "text", text: token, styles: {} };
    });
  };

  const replace = (list: B[]): B[] =>
    list.map((block): B => {
      const children = block.children?.length ? replace(block.children as B[]) : (block.children ?? []);
      const paragraph = (text: string) => ({ type: "paragraph", content: text, children }) as unknown as B;
      switch (block.type) {
        case MATH_BLOCK: {
          const latex = plainText(block.content).trim();
          return paragraph(blockToken(latex ? `$$\n${latex}\n$$` : "$$\n$$"));
        }
        case MERMAID_BLOCK:
          // A code block in the "mermaid" language is exactly its Markdown.
          return { type: "codeBlock", props: { language: "mermaid" }, content: plainText(block.content), children } as unknown as B;
        case TOC_BLOCK:
          return paragraph(blockToken("<!-- esionage:toc -->"));
        case BREADCRUMB_BLOCK:
          return paragraph(blockToken("<!-- esionage:breadcrumb -->"));
        case BOOKMARK_BLOCK:
        case WEB_EMBED_BLOCK: {
          // A bookmark or embed without a (valid) URL yet has nothing to write.
          const url = parseWebUrl(block.props?.url)?.href;
          if (!url) return paragraph("");
          const title = block.type === BOOKMARK_BLOCK ? String(block.props?.title ?? "").trim() : "";
          const link = `[${markdownLinkText(title || url)}](${markdownLinkDestination(url)})`;
          return paragraph(blockToken(block.type === WEB_EMBED_BLOCK ? `${link} <!-- esionage:embed -->` : link));
        }
        case PAGE_LINK_BLOCK: {
          const pageId = String(block.props?.pageId ?? "");
          return paragraph(blockToken(pageId ? `${pageLinkMarkdown("page", workspaceId, pageId)} ${PAGE_LINK_MARKER}` : ""));
        }
        case CALLOUT_BLOCK: {
          const i = callouts.push({
            kind: alertKindForColor(String(block.props?.backgroundColor ?? "")),
            icon: String(block.props?.icon ?? "").trim(),
          });
          const content = inline(block.content);
          return {
            type: "paragraph",
            content: [
              { type: "text", text: `esionage${nonce}c${i - 1}x`, styles: {} },
              ...(Array.isArray(content) ? content : []),
              { type: "text", text: `esionage${nonce}e${i - 1}x`, styles: {} },
            ],
            children,
          } as unknown as B;
        }
        case "codeBlock":
          return { ...block, children };
        default:
          return { ...block, content: inline(block.content), children };
      }
    });

  const finish = (markdown: string) =>
    markdown
      .replace(new RegExp(`^([ \\t]*)esionage${nonce}c(\\d+)x([\\s\\S]*?)esionage${nonce}e\\2x`, "gm"), (_, indent: string, i: string, text: string) => {
        const { kind, icon } = callouts[Number(i)];
        const lines = text.split("\n").map((line, n) => (n === 0 ? line : line.slice(indent.length)));
        if (icon) lines[0] = lines[0] ? `${icon} ${lines[0]}` : icon;
        return [`[!${kind}]`, ...lines]
          .map((line) => `${indent}> ${line}`.trimEnd())
          .join("\n");
      })
      .replace(TOKEN_LINE(nonce), (_, indent: string, i: string) =>
        blockMarkdown[Number(i)]
          .split("\n")
          .map((line) => (line ? indent + line : line))
          .join("\n"),
      )
      .replace(new RegExp(`esionage${nonce}i(\\d+)x`, "g"), (_, i: string) => inlineMarkdown[Number(i)])
      .replaceAll(dollarToken, () => "\\$");

  return { blocks: replace(blocks), finish };
}

// ---------------------------------------------------------------------------------------------
// Import

type Pending =
  | { type: typeof MATH_BLOCK; latex: string }
  | { type: typeof TOC_BLOCK | typeof BREADCRUMB_BLOCK }
  | { type: typeof CALLOUT_BLOCK; kind: AlertKind; markdown: string }
  | { type: typeof BOOKMARK_BLOCK; url: string; title: string }
  | { type: typeof WEB_EMBED_BLOCK; url: string }
  | { type: typeof PAGE_LINK_BLOCK; pageId: string };

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;
const CALLOUT_START = new RegExp(`^ {0,3}> ?\\[!(${ALERT_KINDS.join("|")})\\][ \\t]*(.*)$`, "i");
const QUOTE_LINE = /^ {0,3}> ?(.*)$/;
const MATH_OPEN = /^ {0,3}\$\$(.*)$/;
const MARKER_LINE = /^ {0,3}<!--\s*esionage:(toc|breadcrumb)\s*-->\s*$/;
/** `[text](url) <!-- esionage:embed -->` (or a bare URL before the marker); "bookmark" likewise. */
const WEB_LINE =
  /^ {0,3}(?:\[((?:\\.|[^\\\]])*)\]\((<[^<>\n]*>|[^\s()<>]+)\)|<?(https?:\/\/[^\s<>]+?)>?)\s*<!--\s*esionage:(embed|bookmark)\s*-->\s*$/i;
/** A link alone on its line, then the page-link marker: `[Title](/w/…/p/…) <!-- esionage:page-link -->`. */
const PAGE_LINK_LINE = /^ {0,3}\[(?:[^\]\\]|\\.)*\]\(\s*<?([^)\s>]+)>?\s*\)\s*<!--\s*esionage:page-link\s*-->\s*$/;

/**
 * Swaps the Markdown forms above for tokens BlockNote's parser keeps as plain text. Only lines of
 * their own count for blocks (not ones inside lists or quotes), and nothing inside fenced code.
 */
export function prepareMarkdownImport(markdown: string, nonce: string, { appUrl }: { appUrl?: string } = {}) {
  const blocks: Pending[] = [];
  const inlines: string[] = [];
  const out: string[] = [];
  const lines = markdown.split(/\r?\n/);
  const blockLine = (pending: Pending) => {
    out.push("", `esionage${nonce}b${blocks.push(pending) - 1}x`, "");
  };
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fence) {
      const closing = FENCE_CLOSE.exec(line);
      if (closing && closing[1][0] === fence[0] && closing[1].length >= fence.length) fence = null;
      out.push(line);
      continue;
    }
    const opening = FENCE_OPEN.exec(line);
    if (opening) {
      fence = opening[1];
      out.push(line);
      continue;
    }
    const marker = MARKER_LINE.exec(line);
    if (marker) {
      blockLine({ type: marker[1] === "toc" ? TOC_BLOCK : BREADCRUMB_BLOCK });
      continue;
    }
    const web = WEB_LINE.exec(line);
    const webUrl = web ? parseWebUrl((web[2] ?? web[3]).replace(/^<|>$/g, ""))?.href : undefined;
    if (web && webUrl) {
      if (web[4].toLowerCase() === "embed") blockLine({ type: WEB_EMBED_BLOCK, url: webUrl });
      else blockLine({ type: BOOKMARK_BLOCK, url: webUrl, title: (web[1] ?? "").replace(/\\(.)/g, "$1").trim() });
      continue;
    }
    const pageLink = PAGE_LINK_LINE.exec(line);
    const linkedId = pageLink ? linkedPageId(pageLink[1], appUrl) : null;
    if (linkedId) {
      blockLine({ type: PAGE_LINK_BLOCK, pageId: linkedId });
      continue;
    }
    const callout = CALLOUT_START.exec(line);
    if (callout) {
      const body = callout[2].trim() ? [callout[2]] : [];
      while (i + 1 < lines.length && QUOTE_LINE.test(lines[i + 1])) body.push(QUOTE_LINE.exec(lines[++i])![1]);
      blockLine({ type: CALLOUT_BLOCK, kind: callout[1].toUpperCase() as AlertKind, markdown: body.join("\n") });
      continue;
    }
    const math = MATH_OPEN.exec(line);
    if (math) {
      const latex = displayMath(math[1], lines, i);
      if (latex) {
        i = latex.end;
        blockLine({ type: MATH_BLOCK, latex: latex.latex });
        continue;
      }
    }
    out.push(inlineMath(line, (latex) => `esionage${nonce}i${inlines.push(latex) - 1}x`));
  }
  return { markdown: out.join("\n"), blocks, inlines };
}

/** A $$ … $$ block starting at line `start` (whose text after the opening $$ is `rest`). */
function displayMath(rest: string, lines: string[], start: number): { latex: string; end: number } | null {
  const sameLine = /^(.*)\$\$\s*$/.exec(rest);
  if (sameLine) return { latex: sameLine[1].trim(), end: start };
  const body = [rest];
  for (let j = start + 1; j < lines.length; j++) {
    const closing = /^(.*)\$\$\s*$/.exec(lines[j]);
    if (closing) {
      body.push(closing[1]);
      return { latex: body.join("\n").trim(), end: j };
    }
    body.push(lines[j]);
  }
  return null;
}

/** Replaces the $…$ spans of a line (outside code spans, not escaped) with `token(latex)`. */
function inlineMath(line: string, token: (latex: string) => string): string {
  if (!line.includes("$")) return line;
  let out = "";
  let i = 0;
  while (i < line.length) {
    const char = line[i];
    if (char === "\\") {
      // "\$" is a dollar sign, not an equation's edge (BlockNote's parser keeps other escapes).
      out += line[i + 1] === "$" ? "$" : line.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (char === "`") {
      const run = /^`+/.exec(line.slice(i))![0];
      const close = line.indexOf(run, i + run.length);
      const end = close < 0 ? i + run.length : close + run.length;
      out += line.slice(i, end);
      i = end;
      continue;
    }
    if (char === "$") {
      const delimiter = line[i + 1] === "$" ? "$$" : "$";
      const start = i + delimiter.length;
      const end = closingDollar(line, start, delimiter);
      if (end > start && !/\s/.test(line[start]) && !/\s/.test(line[end - 1])) {
        out += token(line.slice(start, end));
        i = end + delimiter.length;
        continue;
      }
      out += delimiter;
      i = start;
      continue;
    }
    out += char;
    i++;
  }
  return out;
}

function closingDollar(line: string, from: number, delimiter: string): number {
  for (let j = from; j < line.length; j++) {
    if (line[j] === "\\") {
      j++;
      continue;
    }
    if (!line.startsWith(delimiter, j)) continue;
    // "$5 and $10": a closing dollar right before a digit is a price, not the end of an equation.
    if (delimiter === "$" && (line[j + 1] === "$" || /\d/.test(line[j + 1] ?? ""))) return -1;
    return j;
  }
  return -1;
}

/**
 * Turns the tokens left by prepareMarkdownImport back into blocks and inline equations, and code
 * blocks in the "mermaid" language into diagrams. `parse` reads a callout's own Markdown. Links to
 * pages of the app become page mentions, and `@Name` (for `people`) and `@YYYY-MM-DD` in text
 * become person and date mentions (without ids: see carryOverMentions).
 */
export async function finishMarkdownImport<B extends MdBlock>(
  blocks: B[],
  prepared: { blocks: Pending[]; inlines: string[] },
  nonce: string,
  parse: (markdown: string) => Promise<B[]>,
  { people = [], appUrl }: { people?: MentionPerson[]; appUrl?: string } = {},
): Promise<B[]> {
  const blockToken = new RegExp(`^esionage${nonce}b(\\d+)x$`);
  const inlineToken = new RegExp(`esionage${nonce}i(\\d+)x`, "g");

  const splitText = (node: Inline): Inline[] => {
    if (node?.type !== "text" || typeof node.text !== "string" || !node.text.includes(`esionage${nonce}i`)) return [node];
    const out: Inline[] = [];
    let last = 0;
    for (const match of node.text.matchAll(inlineToken)) {
      if (match.index > last) out.push({ ...node, text: node.text.slice(last, match.index) });
      out.push({ type: INLINE_MATH, props: {}, content: prepared.inlines[Number(match[1])] } as Inline);
      last = match.index + match[0].length;
    }
    if (last < node.text.length) out.push({ ...node, text: node.text.slice(last) });
    return out;
  };
  // Where an equation can't go (a link's text), its token becomes the $…$ it came from.
  const restore = (text: string) => text.replace(inlineToken, (_, i: string) => `$${prepared.inlines[Number(i)]}$`);
  const mention = (props: Partial<typeof EMPTY_MENTION>) => ({ type: MENTION, props: { ...EMPTY_MENTION, ...props } }) as Inline;
  const splitMentions = (node: Inline): Inline[] => {
    if (node?.type !== "text" || typeof node.text !== "string" || !node.text.includes("@") || node.styles?.code) return [node];
    return splitMentionText(node.text, people).map((piece) => ("text" in piece ? { ...node, text: piece.text } : mention(piece.mention)));
  };
  const inline = (content: unknown): unknown => {
    if (Array.isArray(content)) {
      return content.flatMap((node: Inline) => {
        if (node?.type === "link") {
          const pageId = linkedPageId(node.href, appUrl);
          if (pageId) return [mention({ kind: "page", pageId })];
        }
        if (node?.type === "link" && Array.isArray(node.content)) {
          return [{ ...node, content: node.content.map((n: Inline) => (typeof n.text === "string" ? { ...n, text: restore(n.text) } : n)) }];
        }
        return splitText(node).flatMap(splitMentions);
      });
    }
    if (isObject(content) && content.type === "tableContent" && Array.isArray(content.rows)) {
      return {
        ...content,
        rows: content.rows.map((row: { cells?: unknown[] }) => ({
          ...row,
          cells: (row.cells ?? []).map((cell) =>
            Array.isArray(cell) ? inline(cell) : isObject(cell) ? { ...cell, content: inline(cell.content) } : cell,
          ),
        })),
      };
    }
    return content;
  };

  const toBlock = async (pending: Pending): Promise<B> => {
    switch (pending.type) {
      case MATH_BLOCK:
        return { type: MATH_BLOCK, content: pending.latex, children: [] } as unknown as B;
      case TOC_BLOCK:
      case BREADCRUMB_BLOCK:
        return { type: pending.type, children: [] } as unknown as B;
      case WEB_EMBED_BLOCK:
        return { type: WEB_EMBED_BLOCK, props: { url: pending.url }, children: [] } as unknown as B;
      case BOOKMARK_BLOCK: {
        // The link text is the title until the details are fetched; a bare URL has none.
        const title = pending.title === pending.url ? "" : pending.title;
        return { type: BOOKMARK_BLOCK, props: { url: pending.url, title }, children: [] } as unknown as B;
      }
      case PAGE_LINK_BLOCK:
        return { type: PAGE_LINK_BLOCK, props: { pageId: pending.pageId }, children: [] } as unknown as B;
      case CALLOUT_BLOCK: {
        // The first paragraph is the callout's text; anything after it is nested under it.
        const inner = pending.markdown.trim() ? await parse(pending.markdown) : [];
        const first = inner[0]?.type === "paragraph" ? inner.shift()! : null;
        let content = Array.isArray(first?.content) ? [...(first.content as Inline[])] : [];
        let icon = "";
        const lead = content[0];
        if (lead?.type === "text" && typeof lead.text === "string") {
          const emoji = leadingEmoji(lead.text);
          if (emoji) {
            icon = emoji;
            const rest = lead.text.slice(emoji.length).replace(/^[ \t]+/, "");
            content = rest ? [{ ...lead, text: rest }, ...content.slice(1)] : content.slice(1);
          }
        }
        return {
          type: CALLOUT_BLOCK,
          props: { icon, backgroundColor: colorForAlertKind(pending.kind) },
          content,
          children: [...(first?.children ?? []), ...inner],
        } as unknown as B;
      }
    }
  };

  const walk = async (list: B[]): Promise<B[]> => {
    const out: B[] = [];
    for (const block of list) {
      const text = Array.isArray(block.content) && block.content.length === 1 ? (block.content[0] as Inline).text : undefined;
      const token = block.type === "paragraph" && typeof text === "string" ? blockToken.exec(text.trim()) : null;
      if (token && prepared.blocks[Number(token[1])]) {
        out.push(await toBlock(prepared.blocks[Number(token[1])]));
        continue;
      }
      const children = block.children?.length ? await walk(block.children as B[]) : (block.children ?? []);
      if (block.type === "codeBlock" && String(block.props?.language ?? "").toLowerCase() === MERMAID_BLOCK) {
        out.push({ type: MERMAID_BLOCK, content: plainText(block.content), children } as unknown as B);
        continue;
      }
      out.push({ ...block, content: inline(block.content), children });
    }
    return out;
  };
  return walk(blocks);
}
