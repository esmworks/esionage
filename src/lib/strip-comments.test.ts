import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { COLLAB_FRAGMENT } from "./collab-constants";
import { THREADS_MAP } from "./comments";
import { stripComments } from "./strip-comments";

function docWithComment() {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment(COLLAB_FRAGMENT);
  const block = new Y.XmlElement("paragraph");
  const text = new Y.XmlText();
  block.insert(0, [text]);
  fragment.insert(0, [block]);
  text.insert(0, "Hello world, again");
  text.format(0, 5, { bold: {} });
  text.format(6, 5, { "comment--abcdEF12": { threadId: "t1", orphan: false } });
  text.format(13, 5, { comment: { threadId: "t2", orphan: false } });
  const thread = new Y.Map();
  thread.set("id", "t1");
  doc.getMap(THREADS_MAP).set("t1", thread);
  return { doc, text };
}

describe("stripComments", () => {
  it("drops threads and comment marks, keeping the text and other marks", () => {
    const { doc, text } = docWithComment();
    expect(stripComments(doc)).toBe(true);
    expect(doc.getMap(THREADS_MAP).size).toBe(0);
    expect(text.toString()).toBe("<bold>Hello</bold> world, again");
    const attributes = (text.toDelta() as { attributes?: Record<string, unknown> }[]).flatMap((op) => Object.keys(op.attributes ?? {}));
    expect(attributes).toEqual(["bold"]);
  });

  it("changes nothing on a page without comments", () => {
    const doc = new Y.Doc();
    const block = new Y.XmlElement("paragraph");
    const text = new Y.XmlText();
    block.insert(0, [text]);
    doc.getXmlFragment(COLLAB_FRAGMENT).insert(0, [block]);
    text.insert(0, "Plain");
    expect(stripComments(doc)).toBe(false);
  });
});
