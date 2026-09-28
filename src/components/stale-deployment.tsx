"use client";

import { useEffect } from "react";

const RELOADED_AT = "leafdesk:stale-deployment-reload";

/**
 * A tab opened before a redeploy still calls server actions by the old build's ids, which the new
 * server doesn't know, so every save fails until the tab is reloaded. Watching the response rather
 * than the thrown error, because most callers catch action errors and show their own message.
 * The guard stops a reload loop if the error comes back right after reloading.
 */
export function StaleDeploymentReload() {
  useEffect(() => {
    const original = window.fetch;
    window.fetch = async (...args) => {
      const res = await original(...args);
      if (res.headers.get("x-nextjs-action-not-found") === "1") reloadOnce();
      return res;
    };
    return () => {
      window.fetch = original;
    };
  }, []);
  return null;
}

function reloadOnce() {
  try {
    const last = Number(sessionStorage.getItem(RELOADED_AT));
    if (last && Date.now() - last < 10_000) return;
    sessionStorage.setItem(RELOADED_AT, String(Date.now()));
  } catch {}
  window.location.reload();
}
