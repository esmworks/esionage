import * as Y from "yjs";
import { THREADS_MAP } from "@/lib/comments";

/**
 * Comment threads live in the page's document, which editors' browsers write to. Only the server
 * may change them (server/comments.ts checks who may do what), so an update from a browser that
 * adds to or deletes from the threads map is refused before it is applied. Browsers never write
 * there themselves: their comment store sends every change to the server.
 */

type AnyType = Y.AbstractType<unknown>;

/** The root type an item sits in. */
function rootOf(item: Y.Item): AnyType | null {
  let type = item.parent as AnyType | null;
  while (type?._item) type = type._item.parent as AnyType | null;
  return type;
}

/** The item with this id in the document, if the document has it. */
function itemAt(doc: Y.Doc, id: Y.ID): Y.Item | null {
  const clock = doc.store.clients.get(id.client);
  if (!clock?.length) return null;
  const last = clock[clock.length - 1];
  if (id.clock >= last.id.clock + last.length) return null;
  const found = Y.getItem(doc.store, id);
  return found instanceof Y.Item ? found : null;
}

const key = (id: Y.ID) => `${id.client}:${id.clock}`;

/** Whether a client's update would change the page's comment threads. */
export function touchesThreads(doc: Y.Doc, update: Uint8Array): boolean {
  const threads = doc.share.get(THREADS_MAP) ?? null;
  const { structs, ds } = Y.decodeUpdate(update);
  const items = structs.filter((s): s is Y.Item => s instanceof Y.Item);

  // Items of this update by id, to follow references between them.
  const own = new Map<string, Y.Item>();
  for (const item of items) for (let i = 0; i < item.length; i++) own.set(key(Y.createID(item.id.client, item.id.clock + i)), item);

  const inThreads = new Map<Y.Item, boolean>();
  const isThreads = (item: Y.Item, depth = 0): boolean => {
    const known = inThreads.get(item);
    if (known !== undefined) return known;
    let result = false;
    if (depth > 10_000) result = true; // a chain this long is no editor's; refuse it
    else if (typeof item.parent === "string") result = item.parent === THREADS_MAP;
    else {
      // Inside another item (a nested type), or next to one: the same place as that item.
      const ref = item.parent instanceof Y.ID ? item.parent : (item.origin ?? item.rightOrigin);
      if (ref) {
        const existing = itemAt(doc, ref);
        if (existing) {
          // A parent item holds a nested type in the same root as the item itself.
          result = threads !== null && rootOf(existing) === threads;
        } else {
          const sibling = own.get(key(ref));
          result = sibling ? isThreads(sibling, depth + 1) : false;
        }
      }
    }
    inThreads.set(item, result);
    return result;
  };

  if (items.some((item) => isThreads(item))) return true;
  if (!threads) return false;
  for (const [client, deletes] of ds.clients) {
    for (const { clock, len } of deletes) {
      for (let at = clock; at < clock + len; ) {
        const existing = itemAt(doc, Y.createID(client, at));
        if (!existing) break;
        if (rootOf(existing) === threads) return true;
        at = existing.id.clock + existing.length;
      }
    }
  }
  return false;
}
