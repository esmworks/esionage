"use client";

import { Plus, TriangleAlert, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui";
import type { ViewConfig, ViewType } from "@/db/schema/app";
import { applyView, filterNeedsValue } from "@/lib/properties";
import { BoardView } from "./board-view";
import { TableView } from "./table-view";
import type { View } from "./types";
import { useDatabase } from "./use-database";
import { ActiveRulesBar, ViewTabs, ViewToolbar } from "./view-bar";

export function DatabasePage({ workspaceId, databaseId }: { workspaceId: string; databaseId: string }) {
  const { snapshot, rows, loadError, error, api } = useDatabase(databaseId);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selectedViewId, setSelectedViewId] = useState<string | null>(() => searchParams.get("view"));

  const views = snapshot?.views ?? [];
  const view = views.find((v) => v.id === selectedViewId) ?? views[0] ?? null;
  const readOnly = snapshot?.database.archived ?? false;

  const selectView = useCallback((id: string) => {
    setSelectedViewId(id);
    // Shallow URL update: keeps the view shareable without a server round trip.
    const url = new URL(window.location.href);
    url.searchParams.set("view", id);
    window.history.replaceState(window.history.state, "", url);
  }, []);

  const visibleRows = useMemo(() => {
    if (!view || !snapshot) return [];
    const filters = (view.config.filters ?? []).filter(
      (f) => !filterNeedsValue(f.op) || (f.value !== undefined && f.value !== null && f.value !== ""),
    );
    return applyView(rows, { filters, sorts: view.config.sorts }, snapshot.properties);
  }, [rows, view, snapshot]);

  if (!snapshot) {
    return loadError ? (
      <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-fg-muted">
        <TriangleAlert className="h-4 w-4 text-danger" />
        Could not load this database: {loadError}
        <Button size="sm" variant="ghost" onClick={() => void api.refetch()}>
          Retry
        </Button>
      </div>
    ) : (
      <DatabaseSkeleton />
    );
  }

  const setConfig = (v: View, config: ViewConfig) => api.updateView(v, { config });

  const addView = async (type: ViewType) => {
    const base = type === "board" ? "Board" : "Table";
    const taken = new Set(views.map((v) => v.name));
    let name = base;
    for (let i = 2; taken.has(name); i++) name = `${base} ${i}`;
    const created = await api.addView(name, type);
    if (created) selectView(created.id);
  };

  const createGroupProperty = async () => {
    const names = new Set(snapshot.properties.map((p) => p.name.toLowerCase()));
    const name = names.has("status") ? "Group" : "Status";
    const created = await api.addProperty(name, "select", ["Not started", "In progress", "Done"]);
    if (created && view?.type === "board") await setConfig(view, { ...view.config, groupBy: created.id });
  };

  const newRow = async () => {
    const id = await api.createRow();
    if (id) router.push(`/w/${workspaceId}/p/${id}`);
  };

  return (
    <div className="@container min-w-0">
      <div className="flex items-end justify-between gap-2 border-b border-border">
        <ViewTabs
          views={views}
          activeId={view?.id ?? ""}
          readOnly={readOnly}
          onSelect={selectView}
          onAdd={addView}
          onRename={(v, name) => api.updateView(v, { name })}
          onDelete={async (v) => {
            if (v.id === view?.id) {
              const next = views.find((x) => x.id !== v.id);
              if (next) selectView(next.id);
            }
            await api.deleteView(v.id);
          }}
        />
        {view && (
          <div className="flex shrink-0 items-center gap-1 pb-1.5">
            <ViewToolbar
              view={view}
              properties={snapshot.properties}
              readOnly={readOnly}
              onConfig={(config) => setConfig(view, config)}
              onCreateGroupProperty={createGroupProperty}
            />
            {!readOnly && (
              <Button size="sm" variant="primary" onClick={newRow} className="ml-1">
                <Plus className="h-3.5 w-3.5" />
                New
              </Button>
            )}
          </div>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="mt-2 flex items-center gap-2 rounded-md border border-border bg-bg-subtle px-3 py-1.5 text-sm"
        >
          <TriangleAlert className="h-4 w-4 shrink-0 text-danger" />
          <span className="flex-1">{error}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={api.clearError}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:bg-bg-hover hover:text-fg"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {view && (
        <ActiveRulesBar
          view={view}
          properties={snapshot.properties}
          readOnly={readOnly}
          onConfig={(config) => setConfig(view, config)}
        />
      )}

      <div className="pt-2">
        {!view ? (
          <div className="py-10 text-center text-sm text-fg-muted">
            This database has no views.
            {!readOnly && (
              <div className="mt-3">
                <Button size="sm" onClick={() => addView("table")}>
                  <Plus className="h-3.5 w-3.5" />
                  Add a table view
                </Button>
              </div>
            )}
          </div>
        ) : view.type === "board" ? (
          <BoardView
            workspaceId={workspaceId}
            view={view}
            properties={snapshot.properties}
            rows={visibleRows}
            api={api}
            readOnly={readOnly}
            onCreateGroupProperty={createGroupProperty}
          />
        ) : (
          <TableView
            workspaceId={workspaceId}
            databaseId={databaseId}
            view={view}
            properties={snapshot.properties}
            rows={visibleRows}
            api={api}
            readOnly={readOnly}
            filtered={rows.length > 0}
          />
        )}
      </div>
    </div>
  );
}

function DatabaseSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading database" className="animate-pulse">
      <div className="flex items-center gap-2 border-b border-border pb-2">
        <div className="h-6 w-20 rounded-md bg-bg-hover" />
        <div className="h-6 w-16 rounded-md bg-bg-hover" />
      </div>
      <div className="mt-3 space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-7 rounded-md bg-bg-subtle" />
        ))}
      </div>
    </div>
  );
}
