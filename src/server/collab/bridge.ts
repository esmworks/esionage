/**
 * The collab service lives in the custom server's module graph (server.ts), next to the
 * Hocuspocus instance. Next.js bundles route handlers separately, so they reach it through
 * this global and exchange only plain data — never Yjs objects — which keeps a single Yjs
 * module instance in the process.
 */

export type WriteActor = { userId: string; oauthClientId?: string | null };

export type PageContent = { title: string; markdown: string; text: string };

export type Channel = `ws:${string}` | `db:${string}`;

export interface CollabService {
  /** Current content, read from the live document when it is open. */
  readPage(pageId: string): Promise<PageContent>;
  /** Replaces the body. Snapshots first when `snapshot` is set (MCP writes). */
  replaceContent(pageId: string, markdown: string, actor: WriteActor, snapshot?: boolean): Promise<void>;
  appendContent(pageId: string, markdown: string, actor: WriteActor, snapshot?: boolean): Promise<void>;
  setTitle(pageId: string, title: string, actor: WriteActor): Promise<void>;
  restoreSnapshot(snapshotId: string, actor: WriteActor): Promise<void>;
  /** Tells subscribed clients to refetch (sidebar tree, database rows). */
  broadcast(channel: Channel, event: string): void;
  /** Drops a user's live connections to the workspace's documents (after removal from it). */
  disconnectUser(userId: string, workspaceId: string): Promise<void>;
}

const KEY = "__esionageCollab";

export function registerCollab(service: CollabService) {
  (globalThis as Record<string, unknown>)[KEY] = service;
}

export function getCollab(): CollabService {
  const service = (globalThis as Record<string, unknown>)[KEY] as CollabService | undefined;
  if (!service) {
    throw new Error("Collab service unavailable: start the app with `pnpm dev` / `pnpm start` (server.ts).");
  }
  return service;
}
