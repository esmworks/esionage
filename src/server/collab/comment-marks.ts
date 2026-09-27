import { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from "y-prosemirror";
import type * as Y from "yjs";
import { serverEditor } from "@/server/blocknote";

/**
 * Comment threads are anchored by a "comment" mark on the text they're about. Browsers set it when
 * someone comments on a selection; these helpers set it on the server: for comments that quote
 * text (MCP), and to put marks back after a write replaced the text that carried them.
 */

type MarkJson = { type: string; attrs?: Record<string, unknown> };
type NodeJson = { type: string; text?: string; marks?: MarkJson[]; content?: NodeJson[]; attrs?: Record<string, unknown> };

const COMMENT_MARK = "comment";
/** Stands in for inline nodes that aren't text (mentions), so quotes never run across them. */
const OBJECT = "￼";

const schema = () => serverEditor.editor.pmSchema;

function readJson(fragment: Y.XmlFragment): NodeJson {
  return yXmlFragmentToProseMirrorRootNode(fragment, schema()).toJSON() as NodeJson;
}

function writeJson(fragment: Y.XmlFragment, json: NodeJson) {
  // Diff-based, like every other server write: only the marked text changes.
  prosemirrorToYXmlFragment(schema().nodeFromJSON(json), fragment);
}

const threadOf = (mark: MarkJson) => (mark.type === COMMENT_MARK && typeof mark.attrs?.threadId === "string" ? mark.attrs.threadId : null);

/** The text each thread is anchored to, where its mark first appears. */
function quotesOf(node: NodeJson, found = new Map<string, string>()): Map<string, string> {
  const content = node.content ?? [];
  // Consecutive pieces of one mark make up its quote; the first run per thread wins.
  const open = new Map<string, string>();
  for (const child of content) {
    const threads = child.type === "text" ? (child.marks ?? []).flatMap((m) => threadOf(m) ?? []) : [];
    for (const [id, text] of open) {
      if (!threads.includes(id)) {
        if (!found.has(id)) found.set(id, text);
        open.delete(id);
      }
    }
    for (const id of threads) open.set(id, (open.get(id) ?? "") + (child.text ?? ""));
    if (child.type !== "text") quotesOf(child, found);
  }
  for (const [id, text] of open) if (!found.has(id)) found.set(id, text);
  return found;
}

/** Marks the first place `quote` appears within one paragraph (or heading, list item…). */
function markQuote(node: NodeJson, quote: string, threadId: string): boolean {
  const content = node.content;
  if (!content?.length) return false;
  if (content.some((c) => c.type === "text")) {
    const text = content.map((c) => (c.type === "text" ? (c.text ?? "") : OBJECT)).join("");
    const at = text.indexOf(quote);
    if (at >= 0) {
      const end = at + quote.length;
      const mark: MarkJson = { type: COMMENT_MARK, attrs: { orphan: false, threadId } };
      const next: NodeJson[] = [];
      let pos = 0;
      for (const c of content) {
        const length = c.type === "text" ? (c.text ?? "").length : 1;
        const start = pos;
        pos += length;
        if (c.type !== "text" || pos <= at || start >= end) {
          next.push(c);
          continue;
        }
        const t = c.text ?? "";
        const from = Math.max(at, start) - start;
        const to = Math.min(end, pos) - start;
        if (from > 0) next.push({ ...c, text: t.slice(0, from) });
        next.push({ ...c, text: t.slice(from, to), marks: [...(c.marks ?? []), mark] });
        if (to < length) next.push({ ...c, text: t.slice(to) });
      }
      node.content = next;
      return true;
    }
  }
  return content.some((child) => markQuote(child, quote, threadId));
}

/** Anchors a thread to the first place the page has `quote`; false when the page doesn't have it. */
export function anchorThread(fragment: Y.XmlFragment, threadId: string, quote: string): boolean {
  if (!quote || quote.includes(OBJECT)) return false;
  const json = readJson(fragment);
  if (!markQuote(json, quote, threadId)) return false;
  writeJson(fragment, json);
  return true;
}

/** The text each thread is anchored to, to put the marks back after a write (see `reanchor`). */
export function threadQuotes(fragment: Y.XmlFragment): Map<string, string> {
  return quotesOf(readJson(fragment));
}

/**
 * Puts back the marks of threads whose text a write replaced, at the first place the page still
 * has the same text. Threads whose text is gone stay without a mark, like after deleting it by hand.
 */
export function reanchor(fragment: Y.XmlFragment, before: Map<string, string>, threadIds: Set<string>) {
  if (!before.size) return;
  const json = readJson(fragment);
  const kept = quotesOf(json);
  let changed = false;
  for (const [id, quote] of before) {
    if (kept.has(id) || !threadIds.has(id)) continue;
    if (markQuote(json, quote, id)) changed = true;
  }
  if (changed) writeJson(fragment, json);
}
