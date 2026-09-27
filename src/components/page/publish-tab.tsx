"use client";

import { Check, ExternalLink, Globe, Link2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
  getPublicationAction,
  publishPageAction,
  setPublicationIndexableAction,
  setWebViewsAction,
  unpublishPageAction,
} from "@/app/actions/publication";
import { ViewIcon } from "@/components/database/property-icons";
import { Button, cn, Switch } from "@/components/ui";
import type { ViewType } from "@/db/schema";

type Publication = { token: string; url: string; indexable: boolean } | null;
type WebView = { id: string; name: string; type: ViewType; published: boolean };

/** Published pages draw these views as they are; the rest show as tables. */
const DRAWN: ViewType[] = ["table", "board", "list", "gallery"];
type Blocker = "needsFullAccess" | "notAllowed" | null;

/** Publish tab of the Share popover: turn the public, read-only link on or off. */
export function PublishTab({ pageId }: { pageId: string }) {
  const t = useTranslations("publish");
  const [publication, setPublication] = useState<Publication | undefined>(undefined);
  // Publishing needs full access and the workspace's publishing policy; unpublishing only full
  // access. The server enforces both; this explains a disabled button.
  const [blocker, setBlocker] = useState<Blocker>(null);
  // Databases: the views published pages show, wherever the database is published.
  const [views, setViews] = useState<WebView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = () =>
    getPublicationAction(pageId).then((r) => {
      setPublication(r.publication);
      setBlocker(r.blocker);
      setViews(r.views);
      return r;
    });

  useEffect(() => {
    load().catch(() => setPublication(null));
  }, [pageId]);

  const absolute = (url: string) => new URL(url, window.location.origin).toString();

  const change = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch {
      // Server action errors lose their message in production, so find the cause here: access
      // or the workspace policy may have changed since the tab opened. The page can't be in the
      // trash, since the Share popover isn't offered there.
      const now = await load().catch(() => null);
      setError(now?.blocker ? t(now.blocker) : t("failed"));
    } finally {
      setBusy(false);
    }
  };

  if (publication === undefined) return <div className="px-3 py-6 text-sm text-fg-muted">…</div>;

  // Only full access matters for taking a page offline.
  const hint = publication ? (blocker === "needsFullAccess" ? blocker : null) : blocker;

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

      {publication && (
        <div className="mt-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm">{t("indexable")}</p>
            <p className="mt-0.5 text-xs text-fg-muted">{t("indexableHint")}</p>
          </div>
          <Switch
            label={t("indexable")}
            checked={publication.indexable}
            disabled={busy || blocker !== null}
            onChange={(indexable) =>
              void change(async () => {
                await setPublicationIndexableAction(pageId, indexable);
                setPublication({ ...publication, indexable });
              })
            }
          />
        </div>
      )}

      {views && views.length > 0 && (
        <div className="mt-4">
          <p className="text-sm">{t("views")}</p>
          <p className="mt-0.5 text-xs text-fg-muted">{t("viewsHint")}</p>
          <ul className="mt-2 flex flex-col">
            {views.map((view) => {
              const picked = views.filter((v) => v.published).map((v) => v.id);
              // The last view left can't be taken off: a published database always shows one.
              const last = view.published && picked.length === 1;
              return (
                <li key={view.id}>
                  <label
                    className={cn(
                      "-mx-1 flex items-center gap-2 rounded px-1 py-1 text-sm",
                      busy || blocker !== null || last ? "cursor-default" : "cursor-pointer hover:bg-bg-hover",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={view.published}
                      disabled={busy || blocker !== null || last}
                      onChange={(e) => {
                        const next = e.target.checked ? [...picked, view.id] : picked.filter((id) => id !== view.id);
                        void change(async () => setViews(await setWebViewsAction(pageId, next)));
                      }}
                      className="h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                    />
                    <ViewIcon type={view.type} className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
                    <span className="min-w-0 truncate">{view.name}</span>
                    {!DRAWN.includes(view.type) && <span className="ml-auto shrink-0 text-xs text-fg-faint">{t("asTable")}</span>}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {error ? (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      ) : (
        hint && <p className="mt-2 text-xs text-fg-muted">{t(hint)}</p>
      )}

      <div className="mt-3">
        {publication ? (
          <Button
            size="sm"
            className="w-full justify-center"
            disabled={busy || blocker === "needsFullAccess"}
            onClick={() => {
              if (confirm(t("confirmUnpublish"))) void change(async () => {
                  await unpublishPageAction(pageId);
                  setPublication(null);
                });
            }}
          >
            {t("unpublish")}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="primary"
            className="w-full justify-center"
            disabled={busy || blocker !== null}
            onClick={() => void change(async () => setPublication(await publishPageAction(pageId)))}
          >
            {t("publish")}
          </Button>
        )}
      </div>
    </div>
  );
}
