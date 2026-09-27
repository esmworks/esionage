"use client";

import { ThreadsSidebar } from "@blocknote/react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { cn, IconButton } from "@/components/ui";

const FILTERS = ["open", "resolved", "all"] as const;
type Filter = (typeof FILTERS)[number];

/**
 * The page's comment threads beside the editor, in the order of the text they're about. Rendered
 * inside BlockNoteView, whose editor the threads belong to.
 */
export function CommentsPanel({ onClose }: { onClose: () => void }) {
  const t = useTranslations("page.comments");
  const [filter, setFilter] = useState<Filter>("open");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !e.defaultPrevented && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside
      aria-label={t("title")}
      className="comments-panel fixed top-11 right-0 bottom-0 z-30 flex w-full flex-col border-l border-border bg-bg md:w-[360px]"
    >
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 px-3">
        <h2 className="text-sm font-semibold">{t("title")}</h2>
        <IconButton label={t("close")} className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </IconButton>
      </div>
      <nav className="flex shrink-0 gap-1 border-b border-border px-3">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={cn(
              "-mb-px border-b-2 px-2 py-1.5 text-sm",
              filter === f ? "border-fg text-fg" : "border-transparent text-fg-muted hover:text-fg",
            )}
          >
            {t(`filters.${f}`)}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <ThreadsSidebar filter={filter} sort="position" />
        <p className="comments-empty px-1 py-6 text-center text-sm text-fg-faint">{t(`empty.${filter}`)}</p>
      </div>
    </aside>
  );
}
