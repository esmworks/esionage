import { DefaultThreadStoreAuth } from "@blocknote/core/comments";
import { YjsThreadStore } from "@blocknote/core/yjs";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { THREADS_MAP } from "@/lib/comments";
import { touchesThreads } from "./thread-guard";

/** A server document with a thread and some text, and a browser's copy of it. */
async function setup() {
  const server = new Y.Doc();
  server.getText("body").insert(0, "Hello world");
  const store = new YjsThreadStore("ann", server.getMap(THREADS_MAP), new DefaultThreadStoreAuth("ann", "editor"));
  const thread = await store.createThread({ initialComment: { body: [{ type: "paragraph", content: "hi" }] } });
  const client = new Y.Doc();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
  return { server, client, thread };
}

/** What the browser would send for `change`. */
function updateFrom(client: Y.Doc, change: () => void) {
  const before = Y.encodeStateVector(client);
  change();
  return Y.encodeStateAsUpdate(client, before);
}

describe("touchesThreads", () => {
  it("lets text edits through", async () => {
    const { server, client } = await setup();
    expect(touchesThreads(server, updateFrom(client, () => client.getText("body").insert(5, ", dear")))).toBe(false);
    expect(touchesThreads(server, updateFrom(client, () => client.getText("body").delete(0, 5)))).toBe(false);
  });

  it("refuses new threads, changed comments and deletions from browsers", async () => {
    const { server, client, thread } = await setup();
    const threads = () => client.getMap<Y.Map<unknown>>(THREADS_MAP);
    expect(touchesThreads(server, updateFrom(client, () => threads().set("forged", new Y.Map())))).toBe(true);
    const comment = () => (threads().get(thread.id)!.get("comments") as Y.Array<Y.Map<unknown>>).get(0);
    expect(touchesThreads(server, updateFrom(client, () => comment().set("userId", "bob")))).toBe(true);
    expect(touchesThreads(server, updateFrom(client, () => threads().get(thread.id)!.set("resolved", true)))).toBe(true);
    expect(touchesThreads(server, updateFrom(client, () => threads().delete(thread.id)))).toBe(true);
  });

  it("refuses threads on a page that has none yet", () => {
    const server = new Y.Doc();
    const client = new Y.Doc();
    expect(touchesThreads(server, updateFrom(client, () => client.getMap(THREADS_MAP).set("t", new Y.Map())))).toBe(true);
  });
});
