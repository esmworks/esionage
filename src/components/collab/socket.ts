"use client";

import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import * as Y from "yjs";

let socket: HocuspocusProviderWebsocket | null = null;
let cachedToken: { value: string; fetchedAt: number } | null = null;
const TOKEN_REUSE_MS = 30 * 60 * 1000; // server-side TTL is 60 minutes

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
};

type Entry = SharedDoc & { refs: number; releaseTimer?: ReturnType<typeof setTimeout> };

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
    const provider = new HocuspocusProvider({
      websocketProvider: getSocket(),
      name,
      document: doc,
      token: getCollabToken,
      onStateless: ({ payload }) => listeners.forEach((l) => l(payload)),
    });
    // Providers sharing a socket are not attached automatically.
    provider.attach();
    entry = {
      name,
      doc,
      provider,
      refs: 0,
      onStateless: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    entries.set(name, entry);
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
        current.provider.destroy();
        current.doc.destroy();
      }, RELEASE_DELAY_MS);
    },
  };
}
