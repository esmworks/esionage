import { ServerBlockNoteEditor } from "@blocknote/server-util";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { blocksToPlainText } from "@/lib/blocks";
import { COLLAB_FRAGMENT } from "@/lib/collab-constants";

// The same conversions the collab service uses for MCP writes and for derived markdown/text.
const editor = ServerBlockNoteEditor.create();

async function write(doc: Y.Doc, markdown: string) {
  const blocks = await editor.tryParseMarkdownToBlocks(markdown);
  doc.transact(() => editor.blocksToYXmlFragment(blocks, doc.getXmlFragment(COLLAB_FRAGMENT)));
}

async function read(doc: Y.Doc) {
  const blocks = editor.yXmlFragmentToBlocks(doc.getXmlFragment(COLLAB_FRAGMENT));
  return { markdown: (await editor.blocksToMarkdownLossy(blocks)).trim(), text: blocksToPlainText(blocks) };
}

describe("markdown ↔ Yjs document", () => {
  it("round-trips common markdown", async () => {
    const source = [
      "# Plan",
      "",
      "Some **bold** and *italic* text with a [link](https://example.com).",
      "",
      "* first",
      "* second",
      "",
      "1. one",
      "2. two",
      "",
      "```ts",
      "const x = 1;",
      "```",
    ].join("\n");
    const doc = new Y.Doc();
    await write(doc, source);
    const { markdown, text } = await read(doc);
    expect(markdown).toContain("# Plan");
    expect(markdown).toContain("**bold**");
    expect(markdown).toContain("[link](https://example.com)");
    expect(markdown).toMatch(/[*-] first/);
    expect(markdown).toContain("1. one");
    expect(markdown).toContain("const x = 1;");
    expect(text).toContain("Some bold and italic text");
  });

  it("replaces content in place and merges with concurrent peers", async () => {
    const server = new Y.Doc();
    await write(server, "Hello\n\nWorld");
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(server));

    await write(server, "Hello\n\nEveryone");
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(server));

    expect((await read(peer)).markdown).toBe("Hello\n\nEveryone");
    expect((await read(server)).markdown).toBe("Hello\n\nEveryone");
  });

  it("clears the document for empty markdown", async () => {
    const doc = new Y.Doc();
    await write(doc, "Something");
    await write(doc, "");
    expect((await read(doc)).text.trim()).toBe("");
  });
});
