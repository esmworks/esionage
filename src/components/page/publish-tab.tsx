"use client";

import { Check, ExternalLink, Globe, Link2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { getPublicationAction, publishPageAction, unpublishPageAction } from "@/app/actions/publication";
import { Button, cn } from "@/components/ui";

type Publication = { token: string; url: string } | null;

/** Publish tab of the Share popover: turn the public, read-only link on or off. */
export function PublishTab({ pageId }: { pageId: string }) {
  const t = useTranslations("publish");
  const [publication, setPublication] = useState<Publication | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getPublicationAction(pageId)
      .then((p) => setPublication(p ?? null))
      .catch(() => setPublication(null));
  }, [pageId]);

  const absolute = (url: string) => new URL(url, window.location.origin).toString();

  const change = async (action: () => Promise<Publication | void>) => {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      setPublication(result ?? null);
    } catch {
      setError(t("needsFullAccess"));
    }
    setBusy(false);
  };

  if (publication === undefined) return <div className="px-3 py-6 text-sm text-fg-muted">…</div>;

  return (
    <div className="p-3">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
            publication ? "bg-accent/15 text-accent" : "bg-bg-hover text-fg-muted",
          )}
        >
          <Globe className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{publication ? t("published") : t("title")}</p>
          <p className="mt-0.5 text-xs text-fg-muted">{t("description")}</p>
        </div>
      </div>

      {publication && (
        <div className="mt-3 flex items-center gap-1 rounded-md border border-border bg-bg-subtle p-1 pl-2">
          <span className="min-w-0 flex-1 truncate text-sm text-fg-muted">{absolute(publication.url)}</span>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(absolute(publication.url));
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="inline-flex h-7 items-center gap-1 rounded px-2 text-sm hover:bg-bg-hover"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Link2 className="h-3.5 w-3.5" />}
            {copied ? t("copied") : t("copyLink")}
          </button>
          <a
            href={publication.url}
            target="_blank"
            rel="noreferrer"
            aria-label={t("open")}
            title={t("open")}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-bg-hover hover:text-fg"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}

      <div className="mt-3">
        {publication ? (
          <Button
            size="sm"
            className="w-full justify-center"
            disabled={busy}
            onClick={() => {
              if (confirm(t("confirmUnpublish"))) void change(() => unpublishPageAction(pageId));
            }}
          >
            {t("unpublish")}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="primary"
            className="w-full justify-center"
            disabled={busy}
            onClick={() => void change(() => publishPageAction(pageId))}
          >
            {t("publish")}
          </Button>
        )}
      </div>
    </div>
  );
}
