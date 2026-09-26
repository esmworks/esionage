"use client";

import type { HocuspocusProvider } from "@hocuspocus/provider";
import { useTranslations } from "next-intl";
import { useEffect, useState, useSyncExternalStore } from "react";
import type * as Y from "yjs";
import { acquireDoc } from "@/components/collab/socket";
import { COLLAB_META } from "@/lib/collab-constants";

export type PageDoc = { doc: Y.Doc; provider: HocuspocusProvider };

/** Opens the page's shared document; `synced` flips once the server state has arrived. */
export function usePageDoc(pageId: string) {
  const t = useTranslations("page.errors");
  const [state, setState] = useState<{ pageDoc: PageDoc | null; synced: boolean; accessLost: boolean }>({
    pageDoc: null,
    synced: false,
    accessLost: false,
  });

  useEffect(() => {
    const { shared, release } = acquireDoc(`page:${pageId}`);
    const { doc, provider } = shared;
    const pageDoc: PageDoc = { doc, provider };
    // A reused provider may already be synced and won't emit "synced" again.
    setState({ pageDoc, synced: provider.isSynced, accessLost: false });
    const onSynced = () => setState((s) => (s.pageDoc?.doc === doc ? { ...s, synced: true } : s));
    const onAuthFailed = () => setState((s) => (s.pageDoc?.doc === doc ? { ...s, accessLost: true } : s));
    provider.on("synced", onSynced);
    provider.on("authenticationFailed", onAuthFailed);
    return () => {
      provider.off("synced", onSynced);
      provider.off("authenticationFailed", onAuthFailed);
      release();
    };
  }, [pageId]);

  // Translated at render time so a language change also updates a message already shown.
  return { pageDoc: state.pageDoc, synced: state.synced, error: state.accessLost ? t("accessLost") : null };
}

/** Live title from the shared doc's meta map. */
export function useDocTitle(doc: Y.Doc | undefined, fallback: string) {
  return useSyncExternalStore(
    (onChange) => {
      if (!doc) return () => {};
      const meta = doc.getMap(COLLAB_META);
      meta.observe(onChange);
      return () => meta.unobserve(onChange);
    },
    () => {
      const value = doc?.getMap(COLLAB_META).get("title");
      return typeof value === "string" ? value : fallback;
    },
    () => fallback,
  );
}

export function setDocTitle(doc: Y.Doc, title: string) {
  doc.getMap(COLLAB_META).set("title", title);
}

const CURSOR_COLORS = ["#e5484d", "#f76b15", "#ffc53d", "#30a46c", "#12a594", "#0090ff", "#6e56cf", "#d6409f"];

export function userColor(userId: string) {
  let hash = 0;
  for (const ch of userId) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
}
