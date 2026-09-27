import type { Readable } from "node:stream";

/**
 * Where uploaded bytes live. The database (`file` table) knows what a file is and who may read it;
 * a driver only stores bytes under a key. Keys are made by server/files.ts (`<workspace>/<file id>`)
 * and never come from a request.
 */
export interface StorageDriver {
  readonly kind: "local" | "s3";
  /** Stores `size` bytes from `body` under `key`, replacing what was there. */
  put(key: string, body: Readable, info: { size: number; contentType: string }): Promise<void>;
  /**
   * The bytes under `key`, or the inclusive `range` of them; null when there is nothing there.
   */
  get(key: string, range?: { start: number; end: number }): Promise<ReadableStream<Uint8Array> | null>;
  /** Removes `key`; missing keys are fine. */
  delete(key: string): Promise<void>;
}

/** Keys the drivers accept: path-like, no traversal, no leading slash. */
export function assertKey(key: string) {
  if (!/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/.test(key) || key.length > 256) throw new Error(`Bad storage key: ${key}`);
}
