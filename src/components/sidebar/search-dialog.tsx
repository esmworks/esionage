"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { searchAction } from "@/app/actions/pages";
import { cn, Dialog, PageIcon, pageLabel } from "@/components/ui";
import type { SearchHit } from "@/server/pages";

export function SearchDialog({ workspaceId, open, onClose }: { workspaceId: string; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const t = useTranslations("sidebar.search");
  const tc = useTranslations("common");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setHits([]);
      setActive(0);
    }
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    // Bumped even when cleared, so a request still in flight can't fill the empty box.
    const id = ++requestId.current;
    if (!q) {
      setHits([]);
      setActive(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      const result = await searchAction(workspaceId, q).catch(() => []);
      if (id !== requestId.current) return; // a newer query is in flight
      setHits(result);
      setActive(0);
      setLoading(false);
    }, 150);
    return () => clearTimeout(timer);
  }, [query, workspaceId]);

  function go(hit: SearchHit | undefined) {
    if (!hit) return;
    onClose();
    router.push(`/w/${hit.workspaceId}/p/${hit.id}`);
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <div className="flex items-center gap-2 border-b border-border px-4">
        <Search className="h-4 w-4 text-fg-muted" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, hits.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              go(hits[active]);
            }
          }}
          placeholder={t("placeholder")}
          aria-label={t("label")}
          className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-faint"
        />
      </div>
      <ul className="max-h-[50vh] overflow-y-auto p-1">
        {query.trim() && !loading && hits.length === 0 && (
          <li className="px-3 py-6 text-center text-sm text-fg-muted">{t("noResults")}</li>
        )}
        {hits.map((hit, i) => (
          <li key={hit.id}>
            <button
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => go(hit)}
              className={cn("flex w-full items-start gap-2 rounded-md px-3 py-2 text-left", i === active && "bg-bg-hover")}
            >
              <PageIcon icon={hit.icon} kind={hit.kind} className="mt-0.5 text-sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{pageLabel(hit.title, tc("untitled"))}</span>
                {hit.snippet && <span className="line-clamp-2 text-xs text-fg-muted">{hit.snippet}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
