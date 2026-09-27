"use client";

import { RotateCcw, SmilePlus } from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, useTransition, type ReactNode } from "react";
import {
  archivePageAction,
  deletePagePermanentlyAction,
  restorePageAction,
  setPageIconAction,
} from "@/app/actions/pages";
import { Button, cn, PageIcon, pageLabel } from "@/components/ui";
import type { PageKind } from "@/db/schema/app";
import { SidebarOpenButton } from "@/components/sidebar/sidebar-context";
import type { PageHeaderInfo } from "@/server/page-meta";
import { HistoryPanel } from "./history-panel";
import { IconPicker } from "./icon-picker";
import { hasLevel, PageHeaderActions } from "./page-header-actions";
import { setDocTitle, useDocTitle, usePageDoc, type ConnectionState } from "./use-page-doc";

// BlockNote touches `window` during setup; render it only in the browser.
const CollabEditor = dynamic(() => import("./collab-editor"), { ssr: false });

type Crumb = { id: string; title: string; icon: string | null; kind: PageKind };

export function PageView({
  workspaceId,
  page,
  info,
  crumbs,
  user,
  showBody,
  wide,
  children,
}: {
  workspaceId: string;
  page: { id: string; parentId: string | null; title: string; icon: string | null; kind: PageKind; archived: boolean };
  info: PageHeaderInfo;
  crumbs: Crumb[];
  user: { id: string; name: string };
  showBody: boolean;
  wide: boolean;
  children?: ReactNode;
}) {
  const router = useRouter();
  const t = useTranslations("page");
  const tc = useTranslations("common");
  const untitled = tc("untitled");
  const { pageDoc, synced, connection, error } = usePageDoc(page.id);
  const title = useDocTitle(pageDoc?.doc, page.title);
  const [icon, setIcon] = useState(page.icon);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const canEdit = hasLevel(info.level, "edit");
  const canDelete = hasLevel(info.level, "full");
  // The collab server drops edits from people who may only view, so don't let them type at all.
  // Offline edits are kept: the doc syncs them when the connection comes back.
  const editable = !page.archived && canEdit && synced && connection !== "noAccess";

  useEffect(() => setIcon(page.icon), [page.icon]);

  // Keep the tab title in sync with live renames.
  useEffect(() => {
    document.title = t("documentTitle", { title: pageLabel(title, untitled) });
  }, [title, untitled, t]);

  /** Runs a page action; a failure shows a message instead of reaching the error boundary. */
  function run(action: () => Promise<void>, onError?: () => void) {
    setActionError(null);
    startTransition(async () => {
      try {
        await action();
      } catch {
        onError?.();
        setActionError(t("header.actionFailed"));
      }
    });
  }

  function changeIcon(next: string | null) {
    const previous = icon;
    setIcon(next);
    run(
      async () => {
        await setPageIconAction(page.id, next);
        router.refresh();
      },
      () => setIcon(previous),
    );
  }

  function moveToTrash() {
    run(async () => {
      await archivePageAction(page.id);
      router.refresh();
    });
  }

  function restore() {
    run(async () => {
      await restorePageAction(page.id);
      router.refresh();
    });
  }

  function deleteForever() {
    if (!confirm(t("archived.confirmDelete"))) return;
    run(async () => {
      await deletePagePermanentlyAction(page.id);
      router.push(`/w/${workspaceId}`);
      router.refresh();
    });
  }

  const parents = crumbs.slice(0, -1);

  const iconPicker = (
    <IconPicker icon={icon} onChange={changeIcon} disabled={page.archived || !canEdit}>
      {(toggle) =>
        icon ? (
          <button
            type="button"
            onClick={toggle}
            className={cn(
              "-ml-1 rounded-md p-1 leading-none",
              wide ? "text-3xl" : "text-5xl",
              !page.archived && canEdit ? "hover:bg-bg-hover" : "cursor-default",
            )}
          >
            {icon}
          </button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={toggle}
            className={cn("-ml-2 opacity-0 transition-opacity group-hover:opacity-100 pointer-coarse:opacity-100", (page.archived || !canEdit) && "hidden")}
          >
            <SmilePlus className="h-4 w-4" /> {t("icon.add")}
          </Button>
        )
      }
    </IconPicker>
  );

  return (
    // Cmd/Ctrl+F with focus anywhere in here opens the page's find bar instead of the browser's.
    <div data-find-scope className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 flex h-11 items-center justify-between gap-2 border-b border-transparent bg-bg/90 px-3 backdrop-blur">
        <nav className="flex min-w-0 items-center gap-1 text-sm text-fg-muted">
          <SidebarOpenButton className="mr-1" />
          {parents.map((c) => (
            <span key={c.id} className="flex min-w-0 items-center gap-1">
              <Link
                href={`/w/${workspaceId}/p/${c.id}`}
                className="flex min-w-0 items-center gap-1 rounded px-1 py-0.5 hover:bg-bg-hover hover:text-fg"
              >
                <PageIcon icon={c.icon} kind={c.kind} className="text-sm" />
                <span className="max-w-40 truncate">{pageLabel(c.title, untitled)}</span>
              </Link>
              <span className="text-fg-faint">/</span>
            </span>
          ))}
          <span className="flex min-w-0 items-center gap-1 px-1 text-fg">
            <PageIcon icon={icon} kind={page.kind} className="text-sm" />
            <span className="max-w-60 truncate">{pageLabel(title, untitled)}</span>
          </span>
        </nav>
        <div className="flex shrink-0 items-center gap-0.5">
          <ConnectionDot connection={connection} />
          <PageHeaderActions
            workspaceId={workspaceId}
            page={{ id: page.id, kind: page.kind, parentId: page.parentId, archived: page.archived, hasBody: showBody }}
            currentUser={user}
            info={info}
            doc={synced ? pageDoc?.doc : undefined}
            onHistory={() => setHistoryOpen(true)}
            commentsOpen={commentsOpen}
            onComments={showBody ? () => setCommentsOpen((open) => !open) : undefined}
            onMoveToTrash={moveToTrash}
          />
        </div>
      </header>

      {page.archived && (
        <div className="flex items-center justify-center gap-3 bg-danger px-4 py-2 text-sm text-white">
          {t("archived.banner")}
          {canEdit && (
            <Button size="sm" className="border-white/60 bg-transparent text-white hover:bg-white/10" onClick={restore} disabled={pending}>
              <RotateCcw className="h-3.5 w-3.5" /> {tc("restore")}
            </Button>
          )}
          {canDelete && (
            <Button size="sm" className="border-white/60 bg-transparent text-white hover:bg-white/10" onClick={deleteForever} disabled={pending}>
              {t("archived.deletePermanently")}
            </Button>
          )}
          {actionError && <span role="alert">{actionError}</span>}
        </div>
      )}

      <div className={cn("w-full flex-1 pb-32", wide ? "pt-6" : "mx-auto max-w-[900px] pt-8 md:pt-12")}>
        <div className={cn(wide ? "page-gutter" : "px-4 md:px-[54px]")}>
          {(!wide || !icon) && <div className="group mb-2 flex h-8 items-end">{iconPicker}</div>}
          {!wide && icon && <div className="h-8" />}
          {/* Wide (database) pages keep the icon beside the title so the view starts higher. */}
          <div className={cn(wide && icon && "flex items-center gap-3")}>
            {wide && icon && iconPicker}
            <TitleField
              value={title}
              compact={wide}
              editable={editable}
              onChange={(v) => pageDoc && setDocTitle(pageDoc.doc, v)}
              onEnter={() => document.querySelector<HTMLElement>(".esionage-editor .ProseMirror")?.focus()}
            />
          </div>
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
          {actionError && !page.archived && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {actionError}
            </p>
          )}
        </div>

        {children && <div className={cn(wide ? "mt-5" : "mt-4 px-4 md:px-[54px]")}>{children}</div>}

        {showBody && (
          <div className="mt-4 min-h-[40vh]">
            {pageDoc && synced ? (
              <CollabEditor
                pageDoc={pageDoc}
                user={user}
                editable={editable}
                level={page.archived || info.level === "none" ? "view" : info.level}
                workspaceId={workspaceId}
                pageId={page.id}
                commentsOpen={commentsOpen}
                onCloseComments={() => setCommentsOpen(false)}
              />
            ) : (
              // Without a connection the error above explains why nothing loads.
              !error && <div className="px-4 text-sm text-fg-faint md:px-[54px]">{tc("loading")}</div>
            )}
          </div>
        )}
      </div>

      {historyOpen && (
        <HistoryPanel pageId={page.id} readOnly={page.archived || !canEdit} onClose={() => setHistoryOpen(false)} />
      )}
    </div>
  );
}

function TitleField({
  value,
  compact = false,
  editable,
  onChange,
  onEnter,
}: {
  value: string;
  /** Wide (database) pages use a smaller title so the views start higher. */
  compact?: boolean;
  editable: boolean;
  onChange: (value: string) => void;
  onEnter: () => void;
}) {
  const t = useTranslations("page");
  const tc = useTranslations("common");
  const ref = useRef<HTMLTextAreaElement>(null);
  // What the field shows right now, including keystrokes the doc hasn't echoed back yet.
  const [text, setText] = useState(value);
  // The field is uncontrolled: when someone else's edit changes the title, write it here and keep
  // the caret where it was relative to the text (a controlled value would jump it to the end).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || el.value === value) return;
    const before = el.value;
    const { selectionStart, selectionEnd } = el;
    el.value = value;
    setText(value);
    if (document.activeElement === el) {
      el.setSelectionRange(shiftIndex(before, value, selectionStart), shiftIndex(before, value, selectionEnd));
    }
  }, [value]);
  const font = cn("font-bold leading-tight", compact ? "text-3xl" : "text-4xl");
  // An invisible copy of the text sizes the box, so the field is only as wide and tall as its text
  // and a click beside the title doesn't start editing it.
  return (
    <div className="relative inline-block min-w-0 max-w-full align-top">
      <span aria-hidden className={cn("invisible block whitespace-pre-wrap break-words", font)}>
        {(text || tc("untitled")) + "\u00a0"}
      </span>
      <textarea
        ref={ref}
        rows={1}
        defaultValue={value}
        readOnly={!editable}
        placeholder={tc("untitled")}
        aria-label={t("title.label")}
        onChange={(e) => {
          const next = e.target.value.replace(/\n/g, "");
          setText(next);
          onChange(next);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onEnter();
          }
        }}
        className={cn(
          "absolute inset-0 block h-full w-full resize-none overflow-hidden bg-transparent outline-none placeholder:text-fg-faint",
          font,
        )}
      />
    </div>
  );
}

/** Where index `i` of `before` ends up in `after`, given one contiguous change between them. */
function shiftIndex(before: string, after: string, i: number) {
  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before[start] === after[start]) start++;
  let end = 0;
  while (end < max - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  if (i <= start) return i;
  if (i >= before.length - end) return i + after.length - before.length;
  return after.length - end;
}

const DOT_COLOR: Record<ConnectionState, string> = {
  live: "bg-emerald-500",
  connecting: "bg-amber-400",
  reconnecting: "bg-amber-400",
  offline: "bg-danger",
  noAccess: "bg-danger",
};

function ConnectionDot({ connection }: { connection: ConnectionState }) {
  const t = useTranslations("page.connection");
  const label = t(connection);
  return (
    <span className="mr-1 flex items-center gap-1.5 text-xs text-fg-faint" title={label}>
      <span className={cn("h-1.5 w-1.5 rounded-full", DOT_COLOR[connection])} />
      {connection !== "live" && label}
    </span>
  );
}
