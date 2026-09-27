"use client";

import type { HocuspocusProvider, onStatusParameters, WebSocketStatus } from "@hocuspocus/provider";
import { useTranslations } from "next-intl";
import { useEffect, useState, useSyncExternalStore } from "react";
import type * as Y from "yjs";
import { acquireDoc } from "@/components/collab/socket";
import { observeDocTitle, readDocTitle, writeDocTitle } from "@/lib/collab-title";

export type PageDoc = { doc: Y.Doc; provider: HocuspocusProvider };

/**
 * `live`: connected and in sync. `connecting`: first connection. `reconnecting`: the socket dropped
 * after the first sync and is coming back. `offline`: no connection (the socket is waiting to retry,
 * or no collab token could be fetched); edits stay local until it returns. `noAccess`: the server
 * turned the page down.
 */
export type ConnectionState = "live" | "connecting" | "reconnecting" | "offline" | "noAccess";

type DocState = {
  pageDoc: PageDoc | null;
  /** Sticky: once the server state has arrived the editor stays mounted through reconnects. */
  synced: boolean;
  /** In sync right now; drops whenever the socket does. */
  live: boolean;
  socket: `${WebSocketStatus}`;
  accessLost: boolean;
  tokenFailed: boolean;
};

/** Opens the page's shared document; `synced` flips once the server state has arrived. */
export function usePageDoc(pageId: string) {
  const t = useTranslations("page.errors");
  const [state, setState] = useState<DocState>({
    pageDoc: null,
    synced: false,
    live: false,
    socket: "connecting",
    accessLost: false,
    tokenFailed: false,
  });

  useEffect(() => {
    const { shared, release } = acquireDoc(`page:${pageId}`);
    const { doc, provider } = shared;
    const pageDoc: PageDoc = { doc, provider };
    const update = (change: (s: DocState) => Partial<DocState>) =>
      setState((s) => (s.pageDoc?.doc === doc ? { ...s, ...change(s) } : s));
    // A reused provider may already be synced and won't emit "synced" again.
    setState({
      pageDoc,
      synced: provider.isSynced,
      live: provider.isSynced,
      socket: provider.configuration.websocketProvider.status,
      accessLost: false,
      tokenFailed: shared.tokenFailed,
    });
    const onSynced = () => update(() => ({ synced: true, live: true, tokenFailed: false }));
    const onStatus = ({ status }: onStatusParameters) =>
      update((s) => ({ socket: status, live: status === "connected" && s.live }));
    // A failed token fetch surfaces as an auth failure too; it is a connection problem, not lost access.
    const onAuthFailed = () => update(() => (shared.tokenFailed ? { tokenFailed: true } : { accessLost: true }));
    provider.on("synced", onSynced);
    provider.on("status", onStatus);
    provider.on("authenticationFailed", onAuthFailed);
    return () => {
      provider.off("synced", onSynced);
      provider.off("status", onStatus);
      provider.off("authenticationFailed", onAuthFailed);
      release();
    };
  }, [pageId]);

  const connection: ConnectionState = state.accessLost
    ? "noAccess"
    : state.socket === "disconnected" || state.tokenFailed
      ? "offline"
      : state.live && state.socket === "connected"
        ? "live"
        : state.synced
          ? "reconnecting"
          : "connecting";

  // Translated at render time so a language change also updates a message already shown.
  const error = state.accessLost ? t("accessLost") : state.tokenFailed ? t("connectionFailed") : null;
  return { pageDoc: state.pageDoc, synced: state.synced, connection, error };
}

/** Live title from the shared doc. */
export function useDocTitle(doc: Y.Doc | undefined, fallback: string) {
  return useSyncExternalStore(
    (onChange) => (doc ? observeDocTitle(doc, onChange) : () => {}),
    () => (doc && readDocTitle(doc)) ?? fallback,
    () => fallback,
  );
}

export function setDocTitle(doc: Y.Doc, title: string) {
  writeDocTitle(doc, title);
}

const CURSOR_COLORS = ["#e5484d", "#f76b15", "#ffc53d", "#30a46c", "#12a594", "#0090ff", "#6e56cf", "#d6409f"];

export function userColor(userId: string) {
  let hash = 0;
  for (const ch of userId) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
}
