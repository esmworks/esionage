"use client";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import { History, X } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { getSnapshotAction, listSnapshotsAction, restoreSnapshotAction } from "@/app/actions/pages";
import { Button, cn, IconButton, pageLabel } from "@/components/ui";

type SnapshotItem = Awaited<ReturnType<typeof listSnapshotsAction>>[number];

const REASONS: Record<string, string> = {
  auto: "Autosave",
  before_mcp_write: "Before AI edit",
  before_restore: "Before restore",
  manual: "Saved version",
};

function describe(s: SnapshotItem) {
  if (s.reason === "before_mcp_write") return `Before edit by ${s.clientName ?? "an AI app"}`;
  return REASONS[s.reason] ?? s.reason;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function Preview({ markdown }: { markdown: string }) {
  const editor = useCreateBlockNote();
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const blocks = await editor.tryParseMarkdownToBlocks(markdown || "");
      if (!cancelled) editor.replaceBlocks(editor.document, blocks.length ? blocks : [{ type: "paragraph" }]);
    })();
    return () => {
      cancelled = true;
    };
  }, [editor, markdown]);
  return <BlockNoteView editor={editor} editable={false} sideMenu={false} slashMenu={false} formattingToolbar={false} />;
}

export function HistoryPanel({ pageId, onClose, readOnly }: { pageId: string; onClose: () => void; readOnly: boolean }) {
  const [items, setItems] = useState<SnapshotItem[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ title: string; markdown: string } | null>(null);
  const [restoring, startRestore] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listSnapshotsAction(pageId)
      .then((list) => {
        if (cancelled) return;
        setItems(list);
        if (list[0]) setSelected(list[0].id);
      })
      .catch(() => {
        if (cancelled) return;
        setItems([]);
        setError("Could not load the page history. Reload the page and try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [pageId]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setPreview(null);
    getSnapshotAction(selected)
      .then((s) => !cancelled && setPreview({ title: s.title, markdown: s.contentMarkdown }))
      .catch(() => !cancelled && setError("Could not load this version."));
    return () => {
      cancelled = true;
    };
  }, [selected]);

  function restore() {
    if (!selected) return;
    setError(null);
    startRestore(async () => {
      try {
        await restoreSnapshotAction(selected);
        onClose();
      } catch {
        setError("Could not restore this version.");
      }
    });
  }

  return (
    <div className="fixed inset-0 z-40 flex bg-black/30" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="m-auto flex h-[80vh] w-full max-w-5xl overflow-hidden rounded-xl border border-border bg-bg shadow-2xl">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 className="truncate text-sm font-medium">{preview ? pageLabel(preview.title) : "Version preview"}</h2>
          </div>
          <div className="flex-1 overflow-y-auto py-6">
            {preview ? (
              <Preview markdown={preview.markdown} />
            ) : (
              <p className="px-12 text-sm text-fg-muted">{items?.length === 0 ? "" : "Loading…"}</p>
            )}
          </div>
        </div>
        <aside className="flex w-72 shrink-0 flex-col border-l border-border bg-bg-subtle">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="flex items-center gap-2 text-sm font-medium">
              <History className="h-4 w-4" /> Page history
            </span>
            <IconButton label="Close" onClick={onClose}>
              <X className="h-4 w-4" />
            </IconButton>
          </div>
          <div className="flex-1 overflow-y-auto px-2">
            {items === null && <p className="px-2 text-sm text-fg-muted">Loading…</p>}
            {items?.length === 0 && !error && (
              <p className="px-2 text-sm text-fg-muted">
                No versions yet. Versions are saved automatically while you edit and before any AI app changes this page.
              </p>
            )}
            {items?.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelected(s.id)}
                className={cn(
                  "mb-0.5 block w-full rounded-md px-2 py-2 text-left hover:bg-bg-hover",
                  selected === s.id && "bg-bg-active hover:bg-bg-active",
                )}
              >
                <div className="text-sm">{dateFormat.format(new Date(s.createdAt))}</div>
                <div className="truncate text-xs text-fg-muted">
                  {describe(s)}
                  {s.authorName && s.reason !== "before_mcp_write" ? ` · ${s.authorName}` : ""}
                </div>
              </button>
            ))}
          </div>
          <div className="border-t border-border p-3">
            {error && <p className="mb-2 text-xs text-danger">{error}</p>}
            <Button variant="primary" className="w-full" disabled={!selected || restoring || readOnly} onClick={restore}>
              {restoring ? "Restoring…" : "Restore this version"}
            </Button>
            <p className="mt-2 text-xs text-fg-muted">The current content is saved as a version first.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
