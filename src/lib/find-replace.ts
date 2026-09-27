import type { Node as PMNode } from "prosemirror-model";
import type { Transaction } from "prosemirror-state";

/**
 * Find and replace in a page body: where a query occurs in a ProseMirror document, and the edits
 * that replace those occurrences. Pure functions over the document; the editor plugin
 * (components/page/find-replace.ts) keeps the state and draws the highlights.
 */

/** One occurrence, as document positions: the matched text is `doc.textBetween(from, to)`. */
export type FindMatch = { from: number; to: number };

export type FindOptions = {
  caseSensitive?: boolean;
  /** Case folding follows the reader's language: in Turkish "I" pairs with "ı" and "İ" with "i". */
  locale?: string;
};

/** Stands in for inline nodes that aren't text (mentions, line breaks), so matches never run across them. */
const OBJECT = "￼";

/**
 * Lower-cases `text` one character at a time so every index still points at the same character.
 * (Plain lower-casing can change the length: "İ" becomes "i" plus a combining dot outside Turkish.)
 */
export function foldCase(text: string, locale?: string): string {
  let out = "";
  for (const ch of text) {
    const lower = ch.toLocaleLowerCase(locale);
    // Only "İ" grows (to "i" and a combining dot); keeping the "i" is what a reader means by it.
    out += lower.length === ch.length ? lower : lower.slice(0, ch.length);
  }
  return out;
}

/**
 * Every occurrence of `query` in the document, in document order. Each text block (paragraph,
 * heading, list item, table cell, code block…) is searched on its own, so a match never spans two
 * blocks; matches in one block don't overlap.
 */
export function findMatches(doc: PMNode, query: string, options: FindOptions = {}): FindMatch[] {
  if (!query || query.includes(OBJECT)) return [];
  const fold = (s: string) => (options.caseSensitive ? s : foldCase(s, options.locale));
  const needle = fold(query);
  const matches: FindMatch[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // The block's text, with the document position of each character.
    let text = "";
    const at: number[] = [];
    node.forEach((child, offset) => {
      const start = pos + 1 + offset;
      if (child.isText) {
        const t = child.text ?? "";
        text += t;
        for (let i = 0; i < t.length; i++) at.push(start + i);
      } else {
        text += OBJECT;
        at.push(start);
      }
    });
    const haystack = fold(text);
    for (let i = haystack.indexOf(needle); i >= 0; i = haystack.indexOf(needle, i + needle.length)) {
      matches.push({ from: at[i], to: at[i + needle.length - 1] + 1 });
    }
    return false;
  });
  return matches;
}

/** The match to start from at `pos`: the first one at or after it, else the first one; -1 when there are none. */
export function matchIndexAt(matches: readonly FindMatch[], pos: number): number {
  if (matches.length === 0) return -1;
  const i = matches.findIndex((m) => m.from >= pos);
  return i < 0 ? 0 : i;
}

/** The next (or, with `step` -1, the previous) match, wrapping around the ends. */
export function stepIndex(current: number, count: number, step: 1 | -1): number {
  if (count === 0) return -1;
  if (current < 0) return step === 1 ? 0 : count - 1;
  return (current + step + count) % count;
}

/**
 * Replaces one match in `tr`. The new text takes the formatting (bold, link, comment…) of the
 * first matched character; an empty replacement deletes the match.
 */
export function replaceMatch(tr: Transaction, match: FindMatch, replacement: string): Transaction {
  if (!replacement) return tr.delete(match.from, match.to);
  const marks = tr.doc.resolve(match.from).nodeAfter?.marks ?? [];
  return tr.replaceWith(match.from, match.to, tr.doc.type.schema.text(replacement, marks));
}

/**
 * Replaces every match in one transaction (one undo step). The matches must have been found in
 * `tr.doc`; they are replaced from the last to the first so the earlier positions stay valid.
 */
export function replaceAllMatches(tr: Transaction, matches: readonly FindMatch[], replacement: string): Transaction {
  const ordered = [...matches].sort((a, b) => b.from - a.from);
  for (const match of ordered) replaceMatch(tr, match, replacement);
  return tr;
}
