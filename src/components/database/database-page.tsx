"use client";

import { Plus, TriangleAlert, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui";
import type { ViewConfig, ViewType } from "@/db/schema/app";
import type { LinkedView } from "@/lib/embed-blocks";
import { applyView, defaultsFromFilters } from "@/lib/properties";
import { galleryCover } from "@/lib/views";
import { BoardView } from "./board-view";
import { CalendarView } from "./calendar-view";
import { ChartView } from "./chart-view";
import { GalleryView } from "./gallery-view";
import { ListView } from "./list-view";
import { PeopleProvider, type PeopleContextValue } from "./person-cell";
import { RelationProvider, type RelationContextValue } from "./relation-context";
import { SchemaProvider } from "./schema-context";
import { TableView } from "./table-view";
import { TimelineView } from "./timeline-view";
import type { DatabaseSnapshot, View } from "./types";
import { useDatabase } from "./use-database";
import { ActiveRulesBar, ViewTabs, ViewToolbar } from "./view-bar";
import { timelineDates, ViewLayoutMenu } from "./view-settings";

/** A database shown inside a page body (see components/page/embed-blocks). */
export type DatabaseEmbed = {
  /**
   * A linked view: one view whose settings the block keeps instead of the database. Without
   * `onChange` (the reader may not edit the page) its filters, sorts and layout stay as they are.
   */
  linked?: { view: LinkedView; onChange?: (view: LinkedView) => void };
  /** Shown above the view tabs once the database has loaded (its name, a link to open it). */
  header?: (snapshot: DatabaseSnapshot) => ReactNode;
};

export function DatabasePage({
  workspaceId,
  databaseId,
  canEdit = true,
  guest = false,
  embed,
}: {
  workspaceId: string;
  databaseId: string;
  /** False for viewers: every change is refused by the server, so the controls are hidden. */
  canEdit?: boolean;
  /** Guests get fewer bulk actions (no trash). */
  guest?: boolean;
  /** Shown inside a page: the selected view stays out of the URL and new rows don't open. */
  embed?: DatabaseEmbed;
}) {
  const t = useTranslations("database");
  const locale = useLocale();
  const linked = embed?.linked;
  const embedded = embed !== undefined;
  const { snapshot, rows, loadError, error, api } = useDatabase(databaseId, {
    covers: linked?.view.type === "gallery" && galleryCover(linked.view.config) === "first_image",
  });
  const router = useRouter();
  const searchParams = useSearchParams();
  const viewParam = embedded ? null : searchParams.get("view");
  const [selectedViewId, setSelectedViewId] = useState<string | null>(viewParam);
  // Sidebar view links change only the query string, so the page stays mounted: follow the URL.
  useEffect(() => {
    if (viewParam) setSelectedViewId(viewParam);
  }, [viewParam]);

  const linkedSettings = linked?.view;
  const linkedView = useMemo<View | null>(
    () =>
      linkedSettings
        ? ({
            id: `linked:${databaseId}`,
            databaseId,
            name: t(`views.${linkedSettings.type}`),
            type: linkedSettings.type,
            config: linkedSettings.config,
            position: 0,
            createdAt: new Date(0),
          } as View)
        : null,
    [linkedSettings, databaseId, t],
  );
  const views = linkedView ? [linkedView] : (snapshot?.views ?? []);
  const view = views.find((v) => v.id === selectedViewId) ?? views[0] ?? null;
  const readOnly = (snapshot?.database.archived ?? false) || !canEdit;
  const locked = snapshot?.database.locked ?? false;
  // A linked view's settings belong to the page showing it, not to the database.
  const configReadOnly = linked ? !linked.onChange : readOnly;

  const selectView = useCallback((id: string) => {
    setSelectedViewId(id);
    if (embedded) return;
    // Shallow URL update: keeps the view shareable without a server round trip. A null state lets
    // Next sync its router with the new URL; passing its own state object would make it ignore the
    // change, and the next server action would put the old URL back.
    const url = new URL(window.location.href);
    url.searchParams.set("view", id);
    window.history.replaceState(null, "", url);
  }, [embedded]);

  const relationContext = useMemo<RelationContextValue | null>(
    () =>
      snapshot && {
        workspaceId,
        databaseId,
        databaseTitle: snapshot.database.title,
        targets: snapshot.relations,
        createRow: api.createRelatedRow,
      },
    [snapshot, workspaceId, databaseId, api.createRelatedRow],
  );

  const peopleContext = useMemo<PeopleContextValue>(
    () => ({ viewerId: snapshot?.viewerId ?? null, people: snapshot?.people ?? [] }),
    [snapshot?.viewerId, snapshot?.people],
  );

  // Changes to a linked view go to its block; the database's own views stay untouched.
  const onLinkedChange = linked?.onChange;
  const isLinked = linked !== undefined;
  const baseApi = useMemo(() => {
    if (!isLinked) return api;
    const updateView = async (v: View, patch: { name?: string; config?: ViewConfig }) => {
      if (patch.config && onLinkedChange) onLinkedChange({ type: v.type, config: patch.config });
      return null;
    };
    return { ...api, updateView: updateView as typeof api.updateView };
  }, [api, isLinked, onLinkedChange]);

  // New rows get the values the active filters ask for, so they don't vanish right after creation.
  const viewApi = useMemo(() => {
    const defaults =
      view && snapshot
        ? defaultsFromFilters(
            view.config.filters,
            snapshot.properties,
            { viewerId: snapshot.viewerId },
            view.config.filterCombinator,
          )
        : {};
    if (!Object.keys(defaults).length) return baseApi;
    return {
      ...baseApi,
      createRow: (input: Parameters<typeof baseApi.createRow>[0] = {}) =>
        baseApi.createRow({ ...input, properties: { ...defaults, ...input.properties } }),
    };
  }, [baseApi, view, snapshot]);

  const visibleRows = useMemo(() => {
    if (!view || !snapshot) return [];
    return applyView(rows, view.config, snapshot.properties, { viewerId: snapshot.viewerId, people: snapshot.people });
  }, [rows, view, snapshot]);

  if (!snapshot) {
    return (
      <div className="page-gutter">
        {loadError ? (
          <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-fg-muted">
            <TriangleAlert className="h-4 w-4 text-danger" />
            {t("page.loadError", { error: loadError })}
            <Button size="sm" variant="ghost" onClick={() => void api.refetch()}>
              {t("page.retry")}
            </Button>
          </div>
        ) : (
          <DatabaseSkeleton />
        )}
      </div>
    );
  }

  const setConfig = (v: View, config: ViewConfig) => baseApi.updateView(v, { config });

  const addView = async (type: ViewType) => {
    // Names for new views follow the UI language; existing names are stored data and stay as-is.
    const base = t(`views.${type}`);
    const taken = new Set(views.map((v) => v.name));
    let name = base;
    for (let i = 2; taken.has(name); i++) name = `${base} ${i}`;
    const created = await api.addView(name, type);
    if (created) selectView(created.id);
  };

  const createGroupProperty = async () => {
    const lower = (s: string) => s.toLocaleLowerCase(locale);
    const names = new Set(snapshot.properties.map((p) => lower(p.name)));
    const status = t("page.defaultGroupProperty");
    const name = names.has(lower(status)) ? t("page.defaultGroupPropertyFallback") : status;
    const created = await api.addProperty(name, "select", [
      t("page.defaultGroupOptions.notStarted"),
      t("page.defaultGroupOptions.inProgress"),
      t("page.defaultGroupOptions.done"),
    ]);
    if (created && (view?.type === "board" || view?.type === "table" || view?.type === "chart")) {
      await setConfig(view, { ...view.config, groupBy: created.id });
    }
  };

  const createDateProperty = async () => {
    const lower = (s: string) => s.toLocaleLowerCase(locale);
    const names = new Set(snapshot.properties.map((p) => lower(p.name)));
    // A timeline takes a new date property as its start, or as its end once it has a start.
    const asEnd = view?.type === "timeline" && !!timelineDates(view, snapshot.properties).start;
    const base = t(asEnd ? "calendar.defaultEndProperty" : "calendar.defaultDateProperty");
    let name = base;
    for (let i = 2; names.has(lower(name)); i++) name = `${base} ${i}`;
    const created = await api.addProperty(name, "date");
    if (created && view?.type === "calendar") await setConfig(view, { ...view.config, dateBy: created.id });
    if (created && view?.type === "timeline") {
      await setConfig(view, { ...view.config, ...(asEnd ? { endDateBy: created.id } : { dateBy: created.id }) });
    }
  };

  const newRow = async () => {
    const id = await viewApi.createRow();
    // Inside a page the new row shows up in place; leaving the page would lose the reader's spot.
    if (id && !embedded) router.push(`/w/${workspaceId}/p/${id}`);
  };

  return (
    <RelationProvider value={relationContext}>
      <PeopleProvider value={peopleContext}>
        <SchemaProvider value={snapshot.properties}>
          {/* Wide layout: controls sit in the page gutter, the board scrolls edge to edge. */}
          <div className="min-w-0">
            <div className="page-gutter">
              {embed?.header?.(snapshot)}
              <div className="flex items-end justify-between gap-2 border-b border-border">
                <ViewTabs
                  views={views}
                  activeId={view?.id ?? ""}
                  readOnly={readOnly || locked || !!linked}
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
                      readOnly={configReadOnly}
                      locked={locked}
                      onConfig={(config) => setConfig(view, config)}
                      onCreateGroupProperty={createGroupProperty}
                      onCreateDateProperty={createDateProperty}
                    />
                    <ViewLayoutMenu
                      view={view}
                      properties={snapshot.properties}
                      readOnly={configReadOnly}
                      locked={locked}
                      onConfig={(config) => setConfig(view, config)}
                      onCreateDateProperty={createDateProperty}
                    />
                    {!readOnly && (
                      <Button size="sm" variant="primary" onClick={newRow} className="ml-1">
                        <Plus className="h-3.5 w-3.5" />
                        {t("page.new")}
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
                    aria-label={t("page.dismiss")}
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
                  readOnly={configReadOnly}
                  onConfig={(config) => setConfig(view, config)}
                />
              )}
            </div>

            <div className="pt-2">
              {!view ? (
                <div className="page-gutter py-10 text-center text-sm text-fg-muted">
                  {t("page.noViews")}
                  {!readOnly && (
                    <div className="mt-3">
                      <Button size="sm" onClick={() => addView("table")}>
                        <Plus className="h-3.5 w-3.5" />
                        {t("page.addTableView")}
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
                  api={viewApi}
                  readOnly={readOnly}
                  locked={locked}
                  onCreateGroupProperty={createGroupProperty}
                />
              ) : view.type === "gallery" ? (
                <GalleryView
                  workspaceId={workspaceId}
                  view={view}
                  properties={snapshot.properties}
                  rows={visibleRows}
                  api={viewApi}
                  readOnly={readOnly}
                />
              ) : view.type === "list" ? (
                <ListView
                  workspaceId={workspaceId}
                  view={view}
                  properties={snapshot.properties}
                  rows={visibleRows}
                  api={viewApi}
                  readOnly={readOnly}
                />
              ) : view.type === "timeline" ? (
                <TimelineView
                  key={view.id}
                  workspaceId={workspaceId}
                  view={view}
                  properties={snapshot.properties}
                  rows={visibleRows}
                  api={viewApi}
                  readOnly={readOnly}
                  locked={locked}
                  onCreateDateProperty={createDateProperty}
                />
              ) : view.type === "chart" ? (
                <ChartView
                  workspaceId={workspaceId}
                  view={view}
                  properties={snapshot.properties}
                  rows={visibleRows}
                  readOnly={readOnly}
                  locked={locked}
                  onCreateGroupProperty={createGroupProperty}
                />
              ) : view.type === "calendar" ? (
                <div className="page-gutter">
                  <CalendarView
                    workspaceId={workspaceId}
                    view={view}
                    properties={snapshot.properties}
                    rows={visibleRows}
                    api={viewApi}
                    readOnly={readOnly}
                    locked={locked}
                    onCreateDateProperty={createDateProperty}
                  />
                </div>
              ) : (
                <TableView
                  workspaceId={workspaceId}
                  databaseId={databaseId}
                  view={view}
                  properties={snapshot.properties}
                  rows={visibleRows}
                  api={viewApi}
                  readOnly={readOnly}
                  locked={locked}
                  filtered={rows.length > 0}
                  guest={guest}
                />
              )}
            </div>
          </div>
        </SchemaProvider>
      </PeopleProvider>
    </RelationProvider>
  );
}

function DatabaseSkeleton() {
  const t = useTranslations("database.page");
  return (
    <div aria-busy="true" aria-label={t("loading")} className="animate-pulse">
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
