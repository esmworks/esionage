import * as Y from "yjs";
import { COLLAB_META } from "./collab-constants";

/**
 * The page title lives in a Y.Text so concurrent typers merge character by character. Older docs
 * kept it as a plain string in the meta map (last writer wins, so keystrokes got lost); those are
 * migrated on their first title write.
 */
export const COLLAB_TITLE = "title";
/** Set in the meta map once the Y.Text holds the title. */
const MIGRATED = "titleText";
const LEGACY = "title";

export function hasTitle(doc: Y.Doc) {
  const meta = doc.getMap(COLLAB_META);
  return meta.get(MIGRATED) === true || typeof meta.get(LEGACY) === "string";
}

/** The doc's title, or undefined when it never had one (callers fall back to `page.title`). */
export function readDocTitle(doc: Y.Doc): string | undefined {
  const meta = doc.getMap(COLLAB_META);
  if (meta.get(MIGRATED) === true) return doc.getText(COLLAB_TITLE).toString();
  const legacy = meta.get(LEGACY);
  return typeof legacy === "string" ? legacy : undefined;
}

/** 32-bit FNV-1a, never 0: a client id that depends only on the text. */
function clientIdFor(text: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) || 1;
}

/**
 * Moves a legacy string title into the Y.Text. The update is built with a client id derived from
 * the text, so two clients migrating the same title at once produce the identical update, which Yjs
 * applies only once, instead of the title appearing twice.
 *
 * Must run outside any transaction: Yjs marks a transaction that applies an update as remote, and a
 * local edit in that same transaction then looks like another client using this doc's id, so Yjs
 * gives the doc a new client id.
 */
export function migrateDocTitle(doc: Y.Doc, origin?: unknown) {
  const meta = doc.getMap(COLLAB_META);
  if (meta.get(MIGRATED) === true) return;
  const legacy = meta.get(LEGACY);
  const text = typeof legacy === "string" ? legacy : "";
  const base = new Y.Doc();
  base.clientID = clientIdFor(text);
  base.getText(COLLAB_TITLE).insert(0, text);
  base.getMap(COLLAB_META).set(MIGRATED, true);
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(base), origin);
  base.destroy();
}

/**
 * Writes `title` as the smallest edit to the current text (common prefix and suffix kept), so a
 * keystroke only inserts or deletes what changed and merges with other people's typing. Callers
 * that wrap this in their own transaction call `migrateDocTitle` before opening it.
 */
export function writeDocTitle(doc: Y.Doc, title: string, origin?: unknown) {
  migrateDocTitle(doc, origin);
  doc.transact(() => {
    const text = doc.getText(COLLAB_TITLE);
    const current = text.toString();
    if (current === title) return;
    let start = 0;
    const max = Math.min(current.length, title.length);
    while (start < max && current[start] === title[start]) start++;
    let end = 0;
    while (end < max - start && current[current.length - 1 - end] === title[title.length - 1 - end]) end++;
    const removed = current.length - start - end;
    if (removed) text.delete(start, removed);
    const inserted = title.slice(start, title.length - end);
    if (inserted) text.insert(start, inserted);
  }, origin);
}

/** Calls `onChange` whenever the title may have changed; returns the unsubscribe function. */
export function observeDocTitle(doc: Y.Doc, onChange: () => void) {
  const meta = doc.getMap(COLLAB_META);
  const text = doc.getText(COLLAB_TITLE);
  meta.observe(onChange);
  text.observe(onChange);
  return () => {
    meta.unobserve(onChange);
    text.unobserve(onChange);
  };
}
