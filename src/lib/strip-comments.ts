import * as Y from "yjs";
import { COLLAB_FRAGMENT } from "./collab-constants";
import { THREADS_MAP } from "./comments";

/**
 * y-prosemirror stores a mark as a text attribute named after it, or, for marks that may overlap
 * like comments, after it plus `--` and a hash of its attributes.
 */
const COMMENT_ATTRIBUTE = /^comment(--[a-zA-Z0-9+/=]{8})?$/;

/**
 * Drops a page document's comments: its threads and the marks anchoring them to text. Used for
 * pages copied from or into a template, which start without the source's conversation. Returns
 * whether anything changed.
 */
export function stripComments(doc: Y.Doc): boolean {
  let changed = false;
  doc.transact(() => {
    const threads = doc.getMap(THREADS_MAP);
    if (threads.size) {
      threads.clear();
      changed = true;
    }
    const walk = (node: Y.XmlFragment | Y.XmlElement) => {
      for (const child of node.toArray()) {
        if (child instanceof Y.XmlText) {
          let index = 0;
          for (const op of child.toDelta() as { insert: unknown; attributes?: Record<string, unknown> }[]) {
            const length = typeof op.insert === "string" ? op.insert.length : 1;
            const marks = Object.keys(op.attributes ?? {}).filter((key) => COMMENT_ATTRIBUTE.test(key));
            if (marks.length) {
              child.format(index, length, Object.fromEntries(marks.map((key) => [key, null])));
              changed = true;
            }
            index += length;
          }
        } else if (child instanceof Y.XmlElement) {
          walk(child);
        }
      }
    };
    walk(doc.getXmlFragment(COLLAB_FRAGMENT));
  });
  return changed;
}
