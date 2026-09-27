"use client";

/**
 * Browser side of the offline copies (see lib/offline.ts for what is kept where). Every function
 * here fails quietly: private windows, full disks and blocked storage just mean no offline copy.
 */
import {
  belongsToSomeoneElse,
  EMPTY_STATE,
  forgetPage,
  isOfflineStore,
  offlineStateKey,
  PAGE_CACHE_PREFIX,
  pageCacheName,
  pageStoreName,
  parseOfflineState,
  rememberRecent,
  setDirty,
  snapshotStoreName,
  snapshotsToEvict,
  META_CACHE,
  type OfflineState,
  type RecentPage,
} from "@/lib/offline";

// ---------------------------------------------------------------------------------------------
// Recently opened pages and pages with unsent edits (localStorage, small and synchronous).

const stateListeners = new Set<() => void>();

export function readOfflineState(userId: string): OfflineState {
  try {
    return parseOfflineState(localStorage.getItem(offlineStateKey(userId)));
  } catch {
    return EMPTY_STATE;
  }
}

function writeOfflineState(userId: string, change: (state: OfflineState) => OfflineState) {
  try {
    const before = readOfflineState(userId);
    const after = change(before);
    if (after === before) return;
    localStorage.setItem(offlineStateKey(userId), JSON.stringify(after));
    stateListeners.forEach((l) => l());
  } catch {}
}

export function onOfflineStateChange(listener: () => void) {
  stateListeners.add(listener);
  return () => void stateListeners.delete(listener);
}

export function rememberPage(userId: string, page: Omit<RecentPage, "at">) {
  writeOfflineState(userId, (s) => {
    const first = s.recent[0];
    // Unchanged and already first: skip the write.
    if (first && first.id === page.id && first.title === page.title && first.icon === page.icon) return s;
    return { ...s, recent: rememberRecent(s.recent, { ...page, at: Date.now() }) };
  });
}

export function markDirty(userId: string, pageId: string, dirty: boolean) {
  writeOfflineState(userId, (s) => setDirty(s, pageId, dirty));
}

// ---------------------------------------------------------------------------------------------
// Snapshots of what server actions returned (sidebar tree, database rows), for reading offline.

type Snapshot<T> = { key: string; savedAt: number; data: T };

export const treeSnapshotKey = (workspaceId: string) => `tree:${workspaceId}`;
export const databaseSnapshotKey = (databaseId: string, covers: boolean) => `db:${databaseId}${covers ? ":covers" : ""}`;
export const rowSnapshotKey = (rowId: string) => `row:${rowId}`;
const SNAPSHOTS = "snapshots";

function openSnapshots(userId: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(snapshotStoreName(userId), 1);
    request.onupgradeneeded = () => request.result.createObjectStore(SNAPSHOTS, { keyPath: "key" });
    request.onsuccess = () => {
      const db = request.result;
      // Let a wipe (deleteDatabase) through instead of blocking it.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("blocked"));
  });
}

function done(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function saveSnapshot<T>(userId: string, key: string, data: T): Promise<void> {
  try {
    const db = await openSnapshots(userId);
    try {
      const tx = db.transaction(SNAPSHOTS, "readwrite");
      const store = tx.objectStore(SNAPSHOTS);
      store.put({ key, savedAt: Date.now(), data } satisfies Snapshot<T>);
      const all = await new Promise<Snapshot<unknown>[]>((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result as Snapshot<unknown>[]);
        req.onerror = () => reject(req.error);
      });
      for (const old of snapshotsToEvict(all.map(({ key, savedAt }) => ({ key, savedAt })))) store.delete(old);
      await done(tx);
    } finally {
      db.close();
    }
  } catch {}
}

export async function loadSnapshot<T>(userId: string, key: string): Promise<{ data: T; savedAt: number } | null> {
  try {
    const db = await openSnapshots(userId);
    try {
      const found = await new Promise<Snapshot<T> | undefined>((resolve, reject) => {
        const req = db.transaction(SNAPSHOTS).objectStore(SNAPSHOTS).get(key);
        req.onsuccess = () => resolve(req.result as Snapshot<T> | undefined);
        req.onerror = () => reject(req.error);
      });
      return found ? { data: found.data, savedAt: found.savedAt } : null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export async function deleteSnapshot(userId: string, key: string): Promise<void> {
  try {
    const db = await openSnapshots(userId);
    try {
      const tx = db.transaction(SNAPSHOTS, "readwrite");
      tx.objectStore(SNAPSHOTS).delete(key);
      await done(tx);
    } finally {
      db.close();
    }
  } catch {}
}

// ---------------------------------------------------------------------------------------------
// Wiping.

function deleteDatabase(name: string) {
  return new Promise<void>((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = request.onerror = () => resolve();
      // Open connections close themselves on versionchange; the delete then goes through.
      request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function databaseNames(): Promise<string[]> {
  try {
    return (await indexedDB.databases()).flatMap((d) => (d.name ? [d.name] : []));
  } catch {
    return [];
  }
}

async function cacheNames(): Promise<string[]> {
  try {
    return typeof caches === "undefined" ? [] : await caches.keys();
  } catch {
    return [];
  }
}

function localStorageKeys(): string[] {
  try {
    return Object.keys(localStorage);
  } catch {
    return [];
  }
}

/** Drops whatever another user of this browser left behind. Runs on every app start. */
export async function wipeOtherUsers(userId: string) {
  const [dbs, cacheKeys] = await Promise.all([databaseNames(), cacheNames()]);
  await Promise.all([
    ...dbs.filter((n) => belongsToSomeoneElse(n, userId)).map(deleteDatabase),
    ...cacheKeys.filter((n) => belongsToSomeoneElse(n, userId)).map((n) => caches.delete(n).catch(() => false)),
  ]);
  for (const key of localStorageKeys()) {
    if (belongsToSomeoneElse(key, userId)) {
      try {
        localStorage.removeItem(key);
      } catch {}
    }
  }
}

/**
 * Sign-out: every offline copy on this browser goes (pages, rows, cached HTML), so the next person
 * using it sees none of it. Open documents must be closed first (see closeOfflineDocs).
 */
export async function wipeAllOfflineData() {
  const [dbs, cacheKeys] = await Promise.all([databaseNames(), cacheNames()]);
  await Promise.all([
    ...dbs.filter(isOfflineStore).map(deleteDatabase),
    ...cacheKeys
      .filter((n) => n.startsWith(PAGE_CACHE_PREFIX) || n === META_CACHE)
      .map((n) => caches.delete(n).catch(() => false)),
  ]);
  for (const key of localStorageKeys()) {
    if (isOfflineStore(key)) {
      try {
        localStorage.removeItem(key);
      } catch {}
    }
  }
  stateListeners.forEach((l) => l());
}

/** The server refused the page: its offline copy, cached HTML and list entries go. */
export async function forgetOfflinePage(userId: string, pageId: string) {
  writeOfflineState(userId, (s) => forgetPage(s, pageId));
  await deleteDatabase(pageStoreName(userId, pageId));
  await Promise.all([
    deleteSnapshot(userId, rowSnapshotKey(pageId)),
    deleteSnapshot(userId, databaseSnapshotKey(pageId, false)),
    deleteSnapshot(userId, databaseSnapshotKey(pageId, true)),
  ]);
  try {
    const cache = await caches.open(pageCacheName(userId));
    const urls = (await cache.keys()).filter((req) => new URL(req.url).pathname.endsWith(`/p/${pageId}`));
    await Promise.all(urls.map((req) => cache.delete(req)));
  } catch {}
}
