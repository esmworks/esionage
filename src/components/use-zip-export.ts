"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { formatBytes } from "@/lib/files";

/**
 * Starts a ZIP export (a page with its subpages, or a whole workspace). The export route is asked
 * first with `check=1`, which answers straight away, so a limit or a running export is shown as a
 * message rather than a failed download; then the browser downloads the archive itself, streamed,
 * without holding it in memory.
 */
export function useZipExport() {
  const t = useTranslations("common.export");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(url: string, onStarted?: () => void) {
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      const separator = url.includes("?") ? "&" : "?";
      const res = await fetch(`${url}${separator}check=1`, { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string; limit?: number } | null;
        if (body?.error === "tooManyPages") setError(t("tooManyPages", { limit: body.limit ?? 0 }));
        else if (body?.error === "tooLarge") setError(t("tooLarge", { size: formatBytes(body.limit ?? 0) }));
        else if (body?.error === "busy") setError(t("busy"));
        else setError(t("failed"));
        return;
      }
      const link = document.createElement("a");
      link.href = url;
      link.download = "";
      document.body.appendChild(link);
      link.click();
      link.remove();
      onStarted?.();
    } catch {
      setError(t("failed"));
    } finally {
      setPending(false);
    }
  }

  return { start, pending, error };
}
