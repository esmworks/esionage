"use client";

import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import * as Y from "yjs";

let socket: HocuspocusProviderWebsocket | null = null;
let cachedToken: { value: string; fetchedAt: number } | null = null;
const TOKEN_REUSE_MS = 30 * 60 * 1000; // server-side TTL is 60 minutes
const TOKEN_RETRY_MS = 5000;

/** One websocket per tab; every page doc and signal channel is multiplexed over it. */
function getSocket() {
  if (!socket) {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    socket = new HocuspocusProviderWebsocket({ url: `${protocol}://${window.location.host}/collab` });
  }
  return socket;
}

async function getCollabToken(): Promise<string> {
  if (cachedToken && Date.now() - cachedToken.fetchedAt < TOKEN_REUSE_MS) return cachedToken.value;
  const res = await fetch("/api/collab-token", { cache: "no-store" });
  if (!res.ok) throw new Error("Could not obtain a collaboration token");
  const { token } = (await res.json()) as { token: string };
  cachedToken = { value: token, fetchedAt: Date.now() };
  return token;
}

export type SharedDoc = {
  name: string;
  doc: Y.Doc;
  provider: HocuspocusProvider;
  onStateless: (listener: (payload: string) => void) => () => void;
  /** True while the last attempt to get a collab token failed (the provider then reports an auth failure). */
  readonly tokenFailed: boolean;
};

type Entry = SharedDoc & { refs: number; releaseTimer?: ReturnType<typeof setTimeout>; retryTimer?: ReturnType<typeof setTimeout> };

const entries = new Map<string, Entry>();

/**
 * Keep released providers alive briefly. Destroying a provider and re-attaching one for the
 * same document on a shared socket races on the server (the late close tears down the new
 * connection and later updates are silently dropped). React StrictMode and quick
 * back-and-forth navigation both do exactly that, so reuse instead of re-creating.
 */
const RELEASE_DELAY_MS = 3000;

/** Acquires the shared provider for a document or signal channel. Call `release` when done. */
export function acquireDoc(name: string): { shared: SharedDoc; release: () => void } {
  let entry = entries.get(name);
  if (entry) {
    clearTimeout(entry.releaseTimer);
    entry.releaseTimer = undefined;
  } else {
    const doc = new Y.Doc();
    const listeners = new Set<(payload: string) => void>();
    let tokenFailed = false;
    const provider = new HocuspocusProvider({
      websocketProvider: getSocket(),
      name,
      document: doc,
      token: async () => {
        clearTimeout(created.retryTimer);
        try {
          const token = await getCollabToken();
          tokenFailed = false;
          return token;
        } catch (error) {
          tokenFailed = true;
          // The provider only asks again after the socket reconnects, which may never happen on a
          // healthy socket. The server queues the sync messages until the token arrives.
          created.retryTimer = setTimeout(() => {
            if (provider.isAttached && !provider.isAuthenticated) void provider.sendToken();
          }, TOKEN_RETRY_MS);
          throw error;
        }
      },
      onStateless: ({ payload }) => listeners.forEach((l) => l(payload)),
    });
    const created: Entry = {
      name,
      doc,
      provider,
      refs: 0,
      onStateless: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      get tokenFailed() {
        return tokenFailed;
      },
    };
    entry = created;
    entries.set(name, entry);
    // Providers sharing a socket are not attached automatically.
    provider.attach();
  }
  const current = entry;
  current.refs++;
  let released = false;
  return {
    shared: current,
    release: () => {
      if (released) return;
      released = true;
      current.refs--;
      if (current.refs > 0) return;
      current.releaseTimer = setTimeout(() => {
        entries.delete(name);
        clearTimeout(current.retryTimer);
        current.provider.destroy();
        current.doc.destroy();
      }, RELEASE_DELAY_MS);
    },
  };
}
