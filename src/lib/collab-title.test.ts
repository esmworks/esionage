import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { COLLAB_META } from "./collab-constants";
import { readDocTitle, writeDocTitle } from "./collab-title";

/** Two replicas of the same doc that exchange their full state, as the collab server relays it. */
function pair(setup?: (doc: Y.Doc) => void) {
  const a = new Y.Doc();
  setup?.(a);
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  const sync = () => {
    const toB = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
    const toA = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
    Y.applyUpdate(b, toB);
    Y.applyUpdate(a, toA);
  };
  return { a, b, sync };
}

const legacy = (title: string) => (doc: Y.Doc) => doc.getMap(COLLAB_META).set("title", title);

describe("doc title", () => {
  it("reads nothing from a doc that never had a title, and legacy string titles as they are", () => {
    expect(readDocTitle(new Y.Doc())).toBeUndefined();
    const doc = new Y.Doc();
    legacy("Plan")(doc);
    expect(readDocTitle(doc)).toBe("Plan");
  });

  it("merges concurrent typing instead of keeping only the last writer", () => {
    const { a, b, sync } = pair((doc) => writeDocTitle(doc, "Plan"));
    writeDocTitle(a, "Plan A");
    writeDocTitle(b, "My Plan");
    sync();
    expect(readDocTitle(a)).toBe("My Plan A");
    expect(readDocTitle(b)).toBe("My Plan A");
  });

  it("migrates a legacy title once even when two people start typing at the same time", () => {
    const { a, b, sync } = pair(legacy("Plan"));
    writeDocTitle(a, "Plan A");
    writeDocTitle(b, "My Plan");
    sync();
    expect(readDocTitle(a)).toBe("My Plan A");
    expect(readDocTitle(b)).toBe("My Plan A");
  });

  it("migrates an empty legacy title and writes minimal edits", () => {
    const { a, b, sync } = pair(legacy(""));
    writeDocTitle(a, "Hello");
    sync();
    writeDocTitle(b, "Hello world");
    // A different spot than b's edit: two inserts at the same spot are ordered by random client id.
    writeDocTitle(a, "Hallo");
    sync();
    expect(readDocTitle(a)).toBe(readDocTitle(b));
    expect(readDocTitle(a)).toBe("Hallo world");
  });

  it("keeps the doc's client id when a write migrates a legacy title", () => {
    const doc = new Y.Doc();
    legacy("Plan")(doc);
    const id = doc.clientID;
    const origins: unknown[] = [];
    doc.on("afterTransaction", (tr: Y.Transaction) => tr.local && origins.push(tr.origin));
    writeDocTitle(doc, "Plan B", "me");
    expect(doc.clientID).toBe(id);
    expect(origins).toContain("me");
  });

  it("clears the title", () => {
    const doc = new Y.Doc();
    writeDocTitle(doc, "Plan");
    writeDocTitle(doc, "");
    expect(readDocTitle(doc)).toBe("");
  });
});
