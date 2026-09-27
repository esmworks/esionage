"use client";

import { ExternalLink, FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { fileUrl, pdfViewUrl } from "@/lib/files";

/**
 * An uploaded PDF shown in place, in the editor's file blocks and on published pages.
 *
 * The browser's own PDF viewer draws it, in an `<object>`: Chrome's viewer refuses to run in a
 * sandboxed iframe, and an `<object>` falls back to its content (the link) where there is no
 * viewer, where an iframe would download the file on every visit (Android). Browsers that say they
 * have no viewer (`navigator.pdfViewerEnabled`) get only the link. The object loads `pdfViewUrl`,
 * which the file route answers only for files stored as application/pdf (served with nosniff and
 * framable by this site alone), so a file merely named ".pdf" shows the fallback instead.
 */
export function PdfViewer({ fileId, name, caption }: { fileId: string; name: string; caption?: string }) {
  const t = useTranslations("page.pdf");
  // Unknown until mounted: the server can't tell, and assuming a viewer keeps the layout steady.
  const [viewer, setViewer] = useState(true);
  useEffect(() => {
    setViewer((navigator as Navigator & { pdfViewerEnabled?: boolean }).pdfViewerEnabled !== false);
  }, []);
  const label = name || t("untitled");
  const link = (
    <a
      href={fileUrl(fileId)}
      target="_blank"
      rel="noopener"
      className="inline-flex max-w-full min-w-0 items-center gap-1.5 text-sm text-fg no-underline hover:underline"
    >
      <FileText className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
      <span className="truncate">{label}</span>
      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-fg-muted" aria-hidden />
      <span className="sr-only">{t("openInNewTab")}</span>
    </a>
  );
  return (
    <div className="w-full min-w-0" contentEditable={false} data-esionage-pdf="">
      <div className="flex min-w-0 items-center justify-between gap-2 pb-1.5">{link}</div>
      {viewer && (
        <object
          data={pdfViewUrl(fileId)}
          type="application/pdf"
          aria-label={t("frameTitle", { name: label })}
          className="block h-[min(36rem,70vh)] w-full rounded-md border border-border bg-bg-subtle"
        >
          <p className="p-3 text-sm text-fg-muted">{t("noPreview")}</p>
        </object>
      )}
      {caption && <p className="pt-1.5 text-sm text-fg-muted">{caption}</p>}
    </div>
  );
}
