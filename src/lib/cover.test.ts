import { ServerBlockNoteEditor } from "@blocknote/server-util";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { COLLAB_FRAGMENT } from "./collab-constants";
import { firstImageInYdoc, isCoverUrl, markdownImageHint, MAX_COVER_URL_LENGTH } from "./cover";

const editor = ServerBlockNoteEditor.create();

function ydocFrom(blocks: unknown[]) {
  const doc = new Y.Doc();
  doc.transact(() => editor.blocksToYXmlFragment(blocks as any, doc.getXmlFragment(COLLAB_FRAGMENT)));
  return Y.encodeStateAsUpdate(doc);
}

describe("isCoverUrl", () => {
  it("accepts http(s) and same-origin paths only", () => {
    expect(isCoverUrl("https://example.com/a.png")).toBe(true);
    expect(isCoverUrl("http://example.com/a.png")).toBe(true);
    expect(isCoverUrl("/files/a.png")).toBe(true);
    expect(isCoverUrl("//evil.example/a.png")).toBe(false);
    expect(isCoverUrl("javascript:alert(1)")).toBe(false);
    expect(isCoverUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(isCoverUrl("")).toBe(false);
    expect(isCoverUrl(42)).toBe(false);
  });

  it("rejects very long urls", () => {
    expect(isCoverUrl(`https://example.com/${"a".repeat(MAX_COVER_URL_LENGTH)}`)).toBe(false);
  });
});

describe("firstImageInYdoc", () => {
  it("finds the first image in reading order, nested blocks included", () => {
    const state = ydocFrom([
      { type: "paragraph", content: "intro", children: [{ type: "image", props: { url: "https://ex.com/nested.png" } }] },
      { type: "image", props: { url: "https://ex.com/second.png", caption: "Second" } },
    ]);
    expect(firstImageInYdoc(state, COLLAB_FRAGMENT)).toBe("https://ex.com/nested.png");
  });

  it("ignores text that looks like image Markdown and images with unsafe urls", () => {
    const state = ydocFrom([
      { type: "paragraph", content: "![fake](https://ex.com/fake.png)" },
      { type: "codeBlock", content: "![code](https://ex.com/code.png)" },
      { type: "image", props: { url: "javascript:alert(1)" } },
      { type: "image", props: { url: "https://ex.com/real.png" } },
    ]);
    expect(firstImageInYdoc(state, COLLAB_FRAGMENT)).toBe("https://ex.com/real.png");
  });

  it("returns null for bodies without images and for missing state", () => {
    expect(firstImageInYdoc(ydocFrom([{ type: "paragraph", content: "no pictures" }]), COLLAB_FRAGMENT)).toBeNull();
    expect(firstImageInYdoc(null, COLLAB_FRAGMENT)).toBeNull();
  });
});

describe("markdownImageHint", () => {
  it("matches both Markdown forms BlockNote writes for images", async () => {
    const markdown = await editor.blocksToMarkdownLossy([
      { type: "image", props: { url: "https://ex.com/a.png", caption: "Cap" } } as any,
    ]);
    expect(markdownImageHint(markdown)).toContain("https://ex.com/a.png");
    expect(markdownImageHint("![](https://ex.com/b.png)")).toBe("![](https://ex.com/b.png)");
    expect(markdownImageHint("plain text")).toBeNull();
  });
});
