"use client";

import { History, Link2, MoreHorizontal, RotateCcw, SmilePlus, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import {
  archivePageAction,
  deletePagePermanentlyAction,
  restorePageAction,
  setPageIconAction,
} from "@/app/actions/pages";
import { Button, cn, IconButton, MenuItem, PageIcon, pageLabel, Popover } from "@/components/ui";
import type { PageKind } from "@/db/schema/app";
import { HistoryPanel } from "./history-panel";
import { IconPicker } from "./icon-picker";
import { setDocTitle, useDocTitle, usePageDoc } from "./use-page-doc";

// BlockNote touches `window` during setup; render it only in the browser.
const CollabEditor = dynamic(() => import("./collab-editor"), { ssr: false });

type Crumb = { id: string; title: string; icon: string | null; kind: PageKind };

export function PageView({
  workspaceId,
  page,
  crumbs,
  user,
  showBody,
  wide,
  children,
}: {
  workspaceId: string;
  page: { id: string; title: string; icon: string | null; kind: PageKind; archived: boolean };
  crumbs: Crumb[];
  user: { id: string; name: string };
  showBody: boolean;
  wide: boolean;
  children?: ReactNode;
}) {
  const router = useRouter();
  const { pageDoc, synced, error } = usePageDoc(page.id);
  const title = useDocTitle(pageDoc?.doc, page.title);
  const [icon, setIcon] = useState(page.icon);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const editable = !page.archived && synced && !error;

  useEffect(() => setIcon(page.icon), [page.icon]);

  // Keep the tab title in sync with live renames.
  useEffect(() => {
    document.title = `${pageLabel(title)} · Esionage`;
  }, [title]);

  function changeIcon(next: string | null) {
    setIcon(next);
    startTransition(async () => {
      await setPageIconAction(page.id, next);
      router.refresh();
    });
  }

  function moveToTrash() {
    startTransition(async () => {
      await archivePageAction(page.id);
      router.refresh();
    });
  }

  function restore() {
    startTransition(async () => {
      await restorePageAction(page.id);
      router.refresh();
    });
  }

  function deleteForever() {
    if (!confirm("Delete this page and everything inside it permanently? This cannot be undone.")) return;
    startTransition(async () => {
      await deletePagePermanentlyAction(page.id);
      router.push(`/w/${workspaceId}`);
      router.refresh();
    });
  }

  const parents = crumbs.slice(0, -1);

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 flex h-11 items-center justify-between gap-2 border-b border-transparent bg-bg/90 px-3 backdrop-blur">
        <nav className="flex min-w-0 items-center gap-1 text-sm text-fg-muted">
          {parents.map((c) => (
            <span key={c.id} className="flex min-w-0 items-center gap-1">
              <Link
                href={`/w/${workspaceId}/p/${c.id}`}
                className="flex min-w-0 items-center gap-1 rounded px-1 py-0.5 hover:bg-bg-hover hover:text-fg"
              >
                <PageIcon icon={c.icon} kind={c.kind} className="text-sm" />
                <span className="max-w-40 truncate">{pageLabel(c.title)}</span>
              </Link>
              <span className="text-fg-faint">/</span>
            </span>
          ))}
          <span className="flex min-w-0 items-center gap-1 px-1 text-fg">
            <PageIcon icon={icon} kind={page.kind} className="text-sm" />
            <span className="max-w-60 truncate">{pageLabel(title)}</span>
          </span>
        </nav>
        <div className="flex items-center gap-1">
          <ConnectionDot synced={synced} error={error} />
          {showBody && (
            <IconButton label="Page history" className="h-7 w-7" onClick={() => setHistoryOpen(true)}>
              <History className="h-4 w-4" />
            </IconButton>
          )}
          <Popover
            align="end"
            trigger={({ toggle }) => (
              <IconButton label="More" className="h-7 w-7" onClick={toggle}>
                <MoreHorizontal className="h-4 w-4" />
              </IconButton>
            )}
          >
            {(close) => (
              <>
                <MenuItem
                  icon={<Link2 className="h-4 w-4" />}
                  onClick={() => {
                    navigator.clipboard.writeText(window.location.href);
                    close();
                  }}
                >
                  Copy link
                </MenuItem>
                {!page.archived && (
                  <MenuItem
                    danger
                    icon={<Trash2 className="h-4 w-4" />}
                    onClick={() => {
                      close();
                      moveToTrash();
                    }}
                  >
                    Move to trash
                  </MenuItem>
                )}
              </>
            )}
          </Popover>
        </div>
      </header>

      {page.archived && (
        <div className="flex items-center justify-center gap-3 bg-danger px-4 py-2 text-sm text-white">
          This page is in the trash.
          <Button size="sm" className="border-white/60 bg-transparent text-white hover:bg-white/10" onClick={restore} disabled={pending}>
            <RotateCcw className="h-3.5 w-3.5" /> Restore
          </Button>
          <Button size="sm" className="border-white/60 bg-transparent text-white hover:bg-white/10" onClick={deleteForever} disabled={pending}>
            Delete permanently
          </Button>
        </div>
      )}

      <div className={cn("mx-auto w-full flex-1 pb-32 pt-12", wide ? "max-w-[1200px] px-12" : "max-w-[900px]")}>
        <div className={cn(!wide && "px-[54px]")}>
          <div className="group mb-2 flex h-8 items-end">
            <IconPicker icon={icon} onChange={changeIcon} disabled={page.archived}>
              {(toggle) =>
                icon ? (
                  <button type="button" onClick={toggle} className="-ml-1 rounded-md p-1 text-5xl leading-none hover:bg-bg-hover">
                    {icon}
                  </button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={toggle}
                    className={cn("-ml-2 opacity-0 transition-opacity group-hover:opacity-100", page.archived && "hidden")}
                  >
                    <SmilePlus className="h-4 w-4" /> Add icon
                  </Button>
                )
              }
            </IconPicker>
          </div>
          {icon && <div className="h-8" />}
          <TitleField
            value={title}
            editable={editable}
            onChange={(v) => pageDoc && setDocTitle(pageDoc.doc, v)}
            onEnter={() => document.querySelector<HTMLElement>(".esionage-editor .ProseMirror")?.focus()}
          />
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        </div>

        {children && <div className={cn("mt-4", !wide && "px-[54px]")}>{children}</div>}

        {showBody && (
          <div className="mt-4 min-h-[40vh]">
            {pageDoc && synced ? (
              <CollabEditor pageDoc={pageDoc} user={user} editable={editable} />
            ) : (
              <div className="px-[54px] text-sm text-fg-faint">Loading…</div>
            )}
          </div>
        )}
      </div>

      {historyOpen && <HistoryPanel pageId={page.id} readOnly={page.archived} onClose={() => setHistoryOpen(false)} />}
    </div>
  );
}

function TitleField({
  value,
  editable,
  onChange,
  onEnter,
}: {
  value: string;
  editable: boolean;
  onChange: (value: string) => void;
  onEnter: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      readOnly={!editable}
      placeholder="Untitled"
      aria-label="Page title"
      onChange={(e) => onChange(e.target.value.replace(/\n/g, ""))}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onEnter();
        }
      }}
      className="w-full resize-none overflow-hidden bg-transparent text-4xl font-bold leading-tight outline-none placeholder:text-fg-faint"
    />
  );
}

function ConnectionDot({ synced, error }: { synced: boolean; error: string | null }) {
  const label = error ? "Offline" : synced ? "Live" : "Connecting";
  return (
    <span className="mr-1 flex items-center gap-1.5 text-xs text-fg-faint" title={label}>
      <span className={cn("h-1.5 w-1.5 rounded-full", error ? "bg-danger" : synced ? "bg-emerald-500" : "bg-amber-400")} />
      {!synced && label}
    </span>
  );
}
