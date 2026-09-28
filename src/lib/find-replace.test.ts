import { EditorState } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { serverEditor } from "@/server/blocknote";
import { findMatches, foldCase, matchIndexAt, replaceAllMatches, replaceMatch, stepIndex } from "./find-replace";

// Page bodies in the page schema (BlockNote's blocks plus the database blocks).
const docOf = (blocks: unknown[]) => serverEditor._blocksToProsemirrorNode(blocks as any);
const stateOf = (blocks: unknown[]) => EditorState.create({ doc: docOf(blocks) });
const texts = (state: EditorState) => {
  const out: string[] = [];
  state.doc.descendants((node) => {
    if (!node.isTextblock) return true;
    out.push(node.textContent);
    return false;
  });
  return out;
};

describe("findMatches", () => {
  it("finds text that runs across formatting within a block", () => {
    const doc = docOf([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Hello ", styles: {} },
          { type: "text", text: "wor", styles: { bold: true } },
          { type: "text", text: "ld and world", styles: {} },
        ],
      },
    ]);
    const matches = findMatches(doc, "world");
    expect(matches).toHaveLength(2);
    expect(matches.map((m) => doc.textBetween(m.from, m.to))).toEqual(["world", "world"]);
    expect(matches[0].from).toBeLessThan(matches[1].from);
  });

  it("never matches across block boundaries", () => {
    const doc = docOf([
      { type: "paragraph", content: "foo" },
      { type: "paragraph", content: "bar" },
      { type: "heading", content: "foo bar" },
    ]);
    expect(findMatches(doc, "foobar")).toEqual([]);
    expect(findMatches(doc, "oob")).toEqual([]);
    const matches = findMatches(doc, "foo");
    expect(matches).toHaveLength(2);
    expect(findMatches(doc, "o b").map((m) => doc.textBetween(m.from, m.to))).toEqual(["o b"]);
  });

  it("searches nested blocks, list items and table cells", () => {
    const doc = docOf([
      { type: "bulletListItem", content: "parent needle", children: [{ type: "paragraph", content: "child needle" }] },
      {
        type: "table",
        content: { type: "tableContent", rows: [{ cells: ["needle", "x"] }, { cells: ["y", "needle here"] }] },
      },
      { type: "codeBlock", content: "const needle = 1;" },
    ]);
    const matches = findMatches(doc, "needle");
    expect(matches).toHaveLength(5);
    for (const m of matches) expect(doc.textBetween(m.from, m.to)).toBe("needle");
  });

  it("ignores case unless asked, folding the way the reader's language does", () => {
    const doc = docOf([{ type: "paragraph", content: "Apple apple APPLE İSTANBUL IRMAK" }]);
    expect(findMatches(doc, "apple")).toHaveLength(3);
    expect(findMatches(doc, "apple", { caseSensitive: true })).toHaveLength(1);
    expect(findMatches(doc, "APPLE", { caseSensitive: true })).toHaveLength(1);
    // "İ" folds to a plain "i" in every language, so positions stay put.
    const [istanbul] = findMatches(doc, "istanbul", { locale: "en" });
    expect(doc.textBetween(istanbul.from, istanbul.to)).toBe("İSTANBUL");
    expect(findMatches(doc, "istanbul", { locale: "tr" })).toHaveLength(1);
    // Turkish pairs "I" with the dotless "ı".
    expect(findMatches(doc, "ırmak", { locale: "tr" })).toHaveLength(1);
    expect(findMatches(doc, "ırmak", { locale: "en" })).toHaveLength(0);
  });

  it("keeps character positions when folding", () => {
    expect(foldCase("İstanbul", "en")).toBe("istanbul");
    expect(foldCase("IŞIK", "tr")).toBe("ışık");
    expect(foldCase("İstanbul").length).toBe("İstanbul".length);
  });

  it("does not overlap matches and ignores an empty query", () => {
    const doc = docOf([{ type: "paragraph", content: "aaaaa" }]);
    expect(findMatches(doc, "aa")).toHaveLength(2);
    expect(findMatches(doc, "")).toEqual([]);
  });

  it("does not run across line breaks", () => {
    const doc = docOf([{ type: "paragraph", content: "one\ntwo" }]);
    expect(findMatches(doc, "onetwo")).toEqual([]);
    const [two] = findMatches(doc, "two");
    expect(doc.textBetween(two.from, two.to)).toBe("two");
  });
});

describe("match navigation", () => {
  const matches = [
    { from: 5, to: 8 },
    { from: 20, to: 23 },
    { from: 40, to: 43 },
  ];

  it("starts at the first match at or after a position, wrapping to the first", () => {
    expect(matchIndexAt(matches, 0)).toBe(0);
    expect(matchIndexAt(matches, 5)).toBe(0);
    expect(matchIndexAt(matches, 6)).toBe(1);
    expect(matchIndexAt(matches, 41)).toBe(0);
    expect(matchIndexAt([], 3)).toBe(-1);
  });

  it("steps forward and back around the ends", () => {
    expect(stepIndex(2, 3, 1)).toBe(0);
    expect(stepIndex(0, 3, -1)).toBe(2);
    expect(stepIndex(-1, 3, 1)).toBe(0);
    expect(stepIndex(-1, 3, -1)).toBe(2);
    expect(stepIndex(0, 0, 1)).toBe(-1);
  });
});

describe("replacing", () => {
  it("replaces one match, keeping the formatting of its first character", () => {
    const state = stateOf([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "say ", styles: {} },
          { type: "text", text: "hel", styles: { bold: true } },
          { type: "text", text: "lo there", styles: {} },
        ],
      },
    ]);
    const [match] = findMatches(state.doc, "hello");
    const next = state.apply(replaceMatch(state.tr, match, "goodbye"));
    expect(texts(next)).toEqual(["say goodbye there"]);
    const [replaced] = findMatches(next.doc, "goodbye");
    let bold = true;
    next.doc.nodesBetween(replaced.from, replaced.to, (node) => {
      if (node.isText && !node.marks.some((m) => m.type.name === "bold")) bold = false;
    });
    expect(bold).toBe(true);
  });

  it("keeps a link when its whole text is replaced", () => {
    const state = stateOf([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "see ", styles: {} },
          { type: "link", href: "https://example.com", content: "docs" },
          { type: "text", text: " now", styles: {} },
        ],
      },
    ]);
    const [match] = findMatches(state.doc, "docs");
    const next = state.apply(replaceMatch(state.tr, match, "guide"));
    const [replaced] = findMatches(next.doc, "guide");
    const node = next.doc.nodeAt(replaced.from);
    expect(node?.marks.map((m) => m.type.name)).toContain("link");
  });

  it("replaces every match in one transaction", () => {
    const state = stateOf([
      { type: "paragraph", content: "cat and cat" },
      { type: "bulletListItem", content: "Cat", children: [{ type: "paragraph", content: "concat" }] },
    ]);
    const matches = findMatches(state.doc, "cat");
    expect(matches).toHaveLength(4);
    const tr = replaceAllMatches(state.tr, matches, "dog");
    expect(tr.steps).toHaveLength(4);
    const next = state.apply(tr);
    expect(texts(next)).toEqual(["dog and dog", "dog", "condog"]);
  });

  it("copes with a replacement that contains the query", () => {
    const state = stateOf([{ type: "paragraph", content: "a b a" }]);
    const next = state.apply(replaceAllMatches(state.tr, findMatches(state.doc, "a"), "aa"));
    expect(texts(next)).toEqual(["aa b aa"]);
  });

  it("deletes matches for an empty replacement without removing their blocks", () => {
    const state = stateOf([
      { type: "paragraph", content: "remove" },
      { type: "paragraph", content: "keep remove keep" },
    ]);
    const next = state.apply(replaceAllMatches(state.tr, findMatches(state.doc, "remove"), ""));
    expect(texts(next)).toEqual(["", "keep  keep"]);
  });
});
