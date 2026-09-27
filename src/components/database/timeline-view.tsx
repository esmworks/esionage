"use client";

import { ChevronRight, PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { Button, cn, PageIcon } from "@/components/ui";
import type { TimelineZoom } from "@/db/schema/app";
import { pageLabel } from "@/lib/labels";
import { groupRows, groupRowsByPerson, isHiddenInView, type RowGroup } from "@/lib/properties";
import { holdsPeople, isComputed } from "@/lib/property-types";
import {
  DAY_WIDTH,
  dayAtX,
  dayDate,
  dayValue,
  dayX,
  dragDays,
  dragSpan,
  headerUnits,
  rowSpan,
  spanValues,
  timelineRange,
  today as todayNumber,
  type DaySpan,
  type DragMode,
} from "@/lib/timeline";
import { TIMELINE_ZOOMS } from "@/lib/views";
import { CardTitleInput } from "./board-view";
import { usePeople } from "./person-cell";
import { isEmptyValue, OptionChip, PropertyDisplay } from "./property-cell";
import { TITLE, type Property, type Row, type View } from "./types";
import type { DatabaseApi } from "./use-database";
import { timelineDates, timelineGroupProperty } from "./view-settings";

const ROW_HEIGHT = 36;
const HEADER_HEIGHT = 48;
/** Room for the title column of the table, and for each property it shows. */
const TITLE_WIDTH = { wide: 240, narrow: 140 };
const PROP_WIDTH = 120;
const MAX_TABLE_PROPS = 2;
/** Pointer travel before a press on a bar counts as a drag rather than a click. */
const DRAG_THRESHOLD = 4;
/** Bars narrower than this show their title beside them instead of inside. */
const MIN_LABEL_WIDTH = 72;

type Drag = { rowId: string; mode: DragMode; originX: number; days: number; moved: boolean };

function subscribeNarrow(onChange: () => void) {
  const query = window.matchMedia("(max-width: 640px)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function useNarrow() {
  return useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia("(max-width: 640px)").matches,
    () => false,
  );
}

/**
 * Swimlanes by a select, status or person property. A thin wrapper over the board's grouping so
 * the timeline follows whatever grouping the board supports.
 */
function laneGroups(rows: Row[], prop: Property, people: ReturnType<typeof usePeople>["people"]): RowGroup<Row>[] {
  return holdsPeople(prop.type) ? groupRowsByPerson(rows, prop, people) : groupRows(rows, prop);
}

export function TimelineView({
  workspaceId,
  view,
  properties,
  rows,
  api,
  readOnly,
  locked,
  onCreateDateProperty,
}: {
  workspaceId: string;
  view: View;
  properties: Property[];
  rows: Row[];
  api: DatabaseApi;
  readOnly?: boolean;
  locked?: boolean;
  onCreateDateProperty: () => void;
}) {
  const t = useTranslations("database");
  const tc = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const { people } = usePeople();
  const narrow = useNarrow();
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  // The config holds the saved zoom and table setting; viewers who can't save still switch locally.
  const [localZoom, setLocalZoom] = useState<TimelineZoom | null>(null);
  const [localTable, setLocalTable] = useState<boolean | null>(null);
  const zoom = localZoom ?? view.config.zoom ?? "week";
  const showTable = localTable ?? view.config.showTable !== false;
  const [drag, setDrag] = useState<Drag | null>(null);
  const [dropDay, setDropDay] = useState<number | null>(null);
  const [dragUndated, setDragUndated] = useState<string | null>(null);
  const [editTitleOf, setEditTitleOf] = useState<string | null>(null);
  const [showUndated, setShowUndated] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  // The day to bring into view after the next layout, and where (a share of the visible width).
  const pendingFocus = useRef<{ day: number; at: number } | null>(null);
  const suppressClick = useRef(false);
  const today = todayNumber();

  const { start: startProp, end: endProp } = timelineDates(view, properties);
  const groupBy = timelineGroupProperty(view, properties);
  // Created and edited times place bars but can't be changed by dragging them.
  const movable = !readOnly && !!startProp && !isComputed(startProp.type);
  const resizable = movable && !!endProp;
  const tableProps = properties
    .filter((p) => p.id !== startProp?.id && p.id !== endProp?.id && !isHiddenInView(view, p))
    .slice(0, narrow ? 0 : MAX_TABLE_PROPS);
  const panelWidth = showTable ? (narrow ? TITLE_WIDTH.narrow : TITLE_WIDTH.wide + tableProps.length * PROP_WIDTH) : 0;

  const spans = useMemo(() => {
    const map = new Map<string, DaySpan>();
    if (!startProp) return map;
    for (const row of rows) {
      const span = rowSpan(row.properties, startProp, endProp);
      if (span) map.set(row.id, span);
    }
    return map;
  }, [rows, startProp, endProp]);
  const dated = useMemo(() => rows.filter((r) => spans.has(r.id)), [rows, spans]);
  const undated = useMemo(() => rows.filter((r) => !spans.has(r.id)), [rows, spans]);
  const range = useMemo(() => timelineRange([...spans.values()], today, zoom), [spans, today, zoom]);
  const header = useMemo(() => headerUnits(range, zoom), [range, zoom]);
  const width = (range.end - range.start + 1) * DAY_WIDTH[zoom];

  const lanes = useMemo(() => {
    if (!groupBy) return [{ key: "", group: null as RowGroup<Row> | null, rows: dated }];
    return laneGroups(dated, groupBy, people)
      .filter((g) => g.rows.length)
      .map((g) => ({ key: g.option?.id ?? "", group: g, rows: g.rows }));
  }, [groupBy, dated, people]);

  const trackWidth = () => (scroller.current?.clientWidth ?? 0) - panelWidth;
  const focusOn = (day: number, at: number) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, dayX(day, range, zoom) - trackWidth() * at);
  };
  // Opens on today; after a zoom change the day that was in the middle stays there.
  const focused = useRef(false);
  useLayoutEffect(() => {
    if (!scroller.current) return;
    const focus = focused.current ? pendingFocus.current : { day: today, at: 1 / 3 };
    focused.current = true;
    pendingFocus.current = null;
    if (focus) focusOn(focus.day, focus.at);
  });

  if (!startProp) {
    return (
      <div className="page-gutter">
        <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border px-6 py-10">
          <div>
            <p className="text-sm font-medium">{t("timeline.needsDateTitle")}</p>
            <p className="mt-1 text-sm text-fg-muted">{t("timeline.needsDateBody")}</p>
          </div>
          {!readOnly && !locked && (
            <Button size="sm" onClick={onCreateDateProperty}>
              <Plus className="h-3.5 w-3.5" />
              {t("calendar.addDateProperty", { name: t("calendar.defaultDateProperty") })}
            </Button>
          )}
        </div>
      </div>
    );
  }

  const setZoom = (next: TimelineZoom) => {
    if (next === zoom) return;
    const el = scroller.current;
    const centre = el ? dayAtX(el.scrollLeft + trackWidth() / 2, range, zoom) : today;
    pendingFocus.current = { day: centre, at: 1 / 2 };
    if (readOnly) setLocalZoom(next);
    else {
      setLocalZoom(null);
      void api.updateView(view, { config: { ...view.config, zoom: next } });
    }
  };
  const toggleTable = () => {
    if (readOnly) setLocalTable(!showTable);
    else {
      setLocalTable(null);
      void api.updateView(view, { config: { ...view.config, showTable: !showTable } });
    }
  };

  const open = (row: Row) => router.push(`/w/${workspaceId}/p/${row.id}`);

  const commit = (row: Row, next: DaySpan) => {
    const before = spans.get(row.id);
    if (!before) return;
    const values = spanValues(before, next, startProp.id, endProp ? { id: endProp.id, hasValue: row.properties[endProp.id] != null } : null);
    if (Object.keys(values).length) void api.setRowValues(row.id, values);
  };

  const onBarPointerDown = (e: PointerEvent<HTMLElement>, row: Row, mode: DragMode) => {
    suppressClick.current = false;
    // Touch keeps scrolling the timeline; bars open on tap. Drags are for mouse and pen.
    if (!movable || e.button !== 0 || e.pointerType === "touch") return;
    if (mode !== "move" && !resizable) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ rowId: row.id, mode, originX: e.clientX, days: 0, moved: false });
  };
  const onBarPointerMove = (e: PointerEvent<HTMLElement>) => {
    if (!drag) return;
    const dx = e.clientX - drag.originX;
    const moved = drag.moved || Math.abs(dx) >= DRAG_THRESHOLD;
    const days = moved ? dragDays(dx, zoom) : 0;
    if (days !== drag.days || moved !== drag.moved) setDrag({ ...drag, days, moved });
  };
  const onBarPointerUp = (row: Row) => {
    if (!drag) return;
    const span = spans.get(row.id);
    if (drag.moved) {
      suppressClick.current = true;
      if (span && drag.days) commit(row, dragSpan(span, drag.mode, drag.days));
    }
    setDrag(null);
  };
  const onBarKeyDown = (e: KeyboardEvent<HTMLElement>, row: Row) => {
    if (e.key === "Enter") open(row);
    // Alt+arrows move a bar by a day, for keyboards.
    if (movable && e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      const span = spans.get(row.id);
      if (span) commit(row, dragSpan(span, "move", e.key === "ArrowLeft" ? -1 : 1));
    }
  };

  // Undated rows are dragged onto a day of the timeline (desktop drag and drop).
  const dayAtPointer = (clientX: number) => {
    const rect = body.current?.getBoundingClientRect();
    const view = scroller.current?.getBoundingClientRect();
    // Over the (sticky) table there is no day to drop on.
    if (!rect || !view || clientX < view.left + panelWidth) return null;
    return dayAtX(clientX - rect.left - panelWidth, range, zoom);
  };
  const onTimelineDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!dragUndated) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const day = dayAtPointer(e.clientX);
    if (day !== dropDay) setDropDay(day);
  };
  const onTimelineDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!dragUndated) return;
    e.preventDefault();
    const day = dayAtPointer(e.clientX);
    const rowId = dragUndated;
    setDragUndated(null);
    setDropDay(null);
    if (day !== null) void api.setCell(rowId, startProp.id, dayValue(day));
  };

  const addRow = async (lane: RowGroup<Row> | null) => {
    const values: Record<string, unknown> = {};
    if (!isComputed(startProp.type)) values[startProp.id] = dayValue(today);
    if (groupBy && lane?.option && !isComputed(groupBy.type)) {
      values[groupBy.id] = holdsPeople(groupBy.type) ? [lane.option.id] : lane.option.id;
    }
    const id = await api.createRow({ properties: values });
    if (id) setEditTitleOf(id);
  };

  const toggleLane = (key: string) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const barFor = (row: Row, color: string | null) => {
    const span = spans.get(row.id)!;
    const shown = drag?.rowId === row.id && drag.moved ? dragSpan(span, drag.mode, drag.days) : span;
    // Bars reaching past the laid-out range are cut at its edge (a sliver when entirely outside).
    const left = Math.min(Math.max(dayX(shown.start, range, zoom), 0), width - 6);
    const right = Math.max(Math.min(dayX(shown.end + 1, range, zoom), width), 6);
    const barWidth = Math.max(right - left, 6);
    const label = pageLabel(row.title, tc("untitled"));
    const dates =
      shown.start === shown.end
        ? format.dateTime(dayDate(shown.start), { dateStyle: "medium", timeZone: "UTC" })
        : format.dateTimeRange(dayDate(shown.start), dayDate(shown.end), { dateStyle: "medium", timeZone: "UTC" });
    const inside = barWidth >= MIN_LABEL_WIDTH;
    return (
      <div
        role="link"
        tabIndex={0}
        aria-label={t("timeline.barLabel", { title: label, dates })}
        title={`${label} · ${dates}`}
        onClick={() => {
          if (suppressClick.current) suppressClick.current = false;
          else open(row);
        }}
        onKeyDown={(e) => onBarKeyDown(e, row)}
        onPointerDown={(e) => onBarPointerDown(e, row, "move")}
        onPointerMove={onBarPointerMove}
        onPointerUp={() => onBarPointerUp(row)}
        onPointerCancel={() => setDrag(null)}
        style={{ left, width: barWidth, top: 5, height: ROW_HEIGHT - 10 }}
        className={cn(
          "group/bar absolute flex items-center rounded-md text-xs select-none",
          color ? `opt-${color}` : "board-card",
          movable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
          drag?.rowId === row.id && drag.moved && "z-10 shadow-md ring-2 ring-accent/50",
        )}
      >
        {inside && (
          <span className="flex min-w-0 items-center gap-1 px-2">
            {row.icon && <PageIcon icon={row.icon} className="shrink-0 text-xs" />}
            <span className={cn("truncate font-medium", !row.title && "opacity-60")}>{label}</span>
          </span>
        )}
        {!inside && (
          <span className="pointer-events-none absolute left-full ml-1.5 flex items-center gap-1 whitespace-nowrap text-fg-muted">
            {label}
          </span>
        )}
        {resizable &&
          (["start", "end"] as const).map((edge) => (
            <span
              key={edge}
              aria-hidden
              title={t(edge === "start" ? "timeline.resizeStart" : "timeline.resizeEnd")}
              onPointerDown={(e) => onBarPointerDown(e, row, edge)}
              className={cn(
                "absolute inset-y-0 w-2 cursor-ew-resize rounded-md opacity-0 group-hover/bar:opacity-100 hover:bg-fg/15",
                edge === "start" ? "left-0" : "right-0",
              )}
            />
          ))}
      </div>
    );
  };

  const tableRow = (row: Row) => (
    <div
      className="sticky left-0 z-10 flex shrink-0 items-center border-r border-border bg-bg"
      style={{ width: panelWidth, height: ROW_HEIGHT }}
    >
      <div
        role="link"
        tabIndex={0}
        onClick={() => editTitleOf !== row.id && open(row)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && editTitleOf !== row.id && e.target === e.currentTarget) open(row);
        }}
        className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 px-2 hover:bg-bg-hover"
      >
        <PageIcon icon={row.icon} className="shrink-0" />
        {editTitleOf === row.id ? (
          <CardTitleInput
            initial={row.title}
            onDone={(title) => {
              setEditTitleOf(null);
              if (title !== row.title) void api.setCell(row.id, TITLE, title);
            }}
          />
        ) : (
          <span className={cn("truncate text-sm", !row.title && "text-fg-faint")}>{pageLabel(row.title, tc("untitled"))}</span>
        )}
      </div>
      {tableProps.map((p) => (
        <div
          key={p.id}
          className="flex h-full shrink-0 items-center overflow-hidden border-l border-border px-2 text-xs text-fg-muted"
          style={{ width: PROP_WIDTH }}
          title={p.name}
        >
          {!isEmptyValue(p, row.properties[p.id]) && <PropertyDisplay prop={p} value={row.properties[p.id]} />}
        </div>
      ))}
    </div>
  );

  const newRowButton = (lane: RowGroup<Row> | null) =>
    !readOnly &&
    showTable && (
      <div className="flex" style={{ height: ROW_HEIGHT - 4 }}>
        <button
          type="button"
          onClick={() => addRow(lane)}
          style={{ width: panelWidth }}
          className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-border bg-bg px-2 text-sm text-fg-muted hover:bg-bg-hover hover:text-fg"
        >
          <Plus className="h-3.5 w-3.5" />
          {t("timeline.new")}
        </button>
      </div>
    );

  const todayX = today >= range.start && today <= range.end ? dayX(today, range, zoom) + DAY_WIDTH[zoom] / 2 : null;
  const dropX = dragUndated && dropDay !== null ? dayX(dropDay, range, zoom) : null;

  return (
    <div className="page-gutter pb-6">
      <div className="flex flex-wrap items-center gap-1 pb-2">
        <button
          type="button"
          aria-pressed={showTable}
          title={t(showTable ? "timeline.hideTable" : "timeline.showTable")}
          aria-label={t(showTable ? "timeline.hideTable" : "timeline.showTable")}
          onClick={toggleTable}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-bg-hover hover:text-fg"
        >
          {showTable ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
        </button>
        <span className="flex-1" />
        <div role="group" aria-label={t("timeline.zoom")} className="inline-flex rounded-md border border-border p-0.5">
          {TIMELINE_ZOOMS.map((z) => (
            <button
              key={z}
              type="button"
              aria-pressed={zoom === z}
              onClick={() => setZoom(z)}
              className={cn(
                "h-6 rounded px-2 text-xs",
                zoom === z ? "bg-bg-active font-medium text-fg" : "text-fg-muted hover:bg-bg-hover hover:text-fg",
              )}
            >
              {t(`timeline.zooms.${z}`)}
            </button>
          ))}
        </div>
        <Button size="sm" variant="ghost" onClick={() => focusOn(today, 1 / 3)}>
          {t("calendar.today")}
        </Button>
      </div>

      <div
        ref={scroller}
        className="relative max-h-[calc(100dvh-14rem)] min-h-72 overflow-auto rounded-lg border border-border [color-scheme:light_dark]"
      >
        <div ref={body} className="relative" style={{ width: panelWidth + width }} onDragOver={onTimelineDragOver} onDrop={onTimelineDrop}>
          {/* Header: month (or year) labels over the columns, both sticky while scrolling down. */}
          <div className="sticky top-0 z-20 flex border-b border-border bg-bg" style={{ height: HEADER_HEIGHT }}>
            {showTable && (
              <div
                className="sticky left-0 z-10 flex shrink-0 items-end border-r border-border bg-bg text-xs text-fg-muted"
                style={{ width: panelWidth }}
              >
                <div className="flex min-w-0 flex-1 items-center px-2 pb-1.5">{t("nameColumn")}</div>
                {tableProps.map((p) => (
                  <div key={p.id} className="shrink-0 truncate border-l border-border px-2 pb-1.5" style={{ width: PROP_WIDTH }}>
                    {p.name}
                  </div>
                ))}
              </div>
            )}
            <div className="relative shrink-0" style={{ width }}>
              {header.top.map((u) => (
                <div
                  key={`t${u.start}`}
                  className="absolute top-0 flex h-6 items-center border-l border-border px-2 text-xs font-medium whitespace-nowrap first-letter:uppercase"
                  style={{ left: dayX(u.start, range, zoom), width: u.days * DAY_WIDTH[zoom] }}
                >
                  <span className="sticky truncate" style={{ left: panelWidth + 8 }}>
                    {zoom === "month"
                      ? dayDate(u.start).getUTCFullYear()
                      : format.dateTime(dayDate(u.start), { month: "long", year: "numeric", timeZone: "UTC" })}
                  </span>
                </div>
              ))}
              {header.columns.map((u) => (
                <div
                  key={`c${u.start}`}
                  className={cn(
                    "absolute top-6 flex h-6 items-center text-xs whitespace-nowrap tabular-nums",
                    zoom === "day" ? "justify-center" : "px-1.5",
                    u.start <= today && today < u.start + u.days ? "font-medium text-accent" : "text-fg-muted",
                  )}
                  style={{ left: dayX(u.start, range, zoom), width: u.days * DAY_WIDTH[zoom] }}
                >
                  {zoom === "day"
                    ? dayDate(u.start).getUTCDate()
                    : zoom === "week"
                      ? format.dateTime(dayDate(u.start), { day: "numeric", month: "short", timeZone: "UTC" })
                      : format.dateTime(dayDate(u.start), { month: "short", timeZone: "UTC" })}
                </div>
              ))}
            </div>
          </div>

          {/* Column lines, today and the drop target sit behind the bars. */}
          <div aria-hidden className="pointer-events-none absolute inset-y-0" style={{ left: panelWidth, width }}>
            {header.columns.map((u) => (
              <div
                key={u.start}
                className={cn(
                  "absolute inset-y-0 border-l border-border/60",
                  zoom === "day" && [0, 6].includes(dayDate(u.start).getUTCDay()) && "bg-bg-subtle",
                )}
                style={{ left: dayX(u.start, range, zoom), width: u.days * DAY_WIDTH[zoom] }}
              />
            ))}
            {todayX !== null && <div className="absolute inset-y-0 w-px bg-accent" style={{ left: todayX }} />}
            {dropX !== null && (
              <div className="absolute inset-y-0 bg-accent/15" style={{ left: dropX, width: DAY_WIDTH[zoom] }} />
            )}
          </div>

          {lanes.map(({ key, group, rows: laneRows }) => {
            const expanded = !collapsed.has(key);
            const color = group?.option && !group.person ? group.option.color : null;
            return (
              <section key={key || "__none"} aria-label={group ? laneName(group) : undefined} className="relative">
                {group && (
                  <div className="flex border-b border-border" style={{ height: ROW_HEIGHT }}>
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => toggleLane(key)}
                      className="sticky left-0 z-10 flex max-w-full min-w-0 items-center gap-1.5 bg-bg px-2 text-sm"
                    >
                      <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-fg-muted transition-transform", expanded && "rotate-90")} />
                      {group.option && !group.person ? (
                        <OptionChip option={group.option} dot={groupBy?.type === "status"} className="min-w-0 font-medium" />
                      ) : (
                        <span className={cn("truncate font-medium", !group.option && "text-fg-muted")}>{laneName(group)}</span>
                      )}
                      <span className="text-xs text-fg-muted tabular-nums">{laneRows.length}</span>
                    </button>
                  </div>
                )}
                {expanded &&
                  laneRows.map((row) => (
                    <div key={row.id} className="flex border-b border-border/60" style={{ height: ROW_HEIGHT }}>
                      {showTable && tableRow(row)}
                      <div className="relative shrink-0" style={{ width }}>
                        {barFor(row, color)}
                      </div>
                    </div>
                  ))}
                {expanded && newRowButton(group)}
              </section>
            );
          })}
          {!dated.length && (
            <div className="sticky left-0 px-3 py-6 text-sm text-fg-muted" style={{ width: "min(100%, 28rem)" }}>
              {t("timeline.empty", { property: startProp.name })}
            </div>
          )}
          {!groupBy && !dated.length && newRowButton(null)}
        </div>
      </div>

      {undated.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            aria-expanded={showUndated}
            onClick={() => setShowUndated((v) => !v)}
            className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-sm text-fg-muted hover:bg-bg-hover hover:text-fg"
          >
            <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", showUndated && "rotate-90")} />
            {t("calendar.noDate", { count: undated.length, property: startProp.name })}
          </button>
          {showUndated && (
            <section aria-label={t("calendar.noDateTitle", { property: startProp.name })} className="mt-1">
              {movable && <p className="px-1.5 pb-1.5 text-xs text-fg-faint">{t("timeline.dragHint")}</p>}
              <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-1.5">
                {undated.map((row) => (
                  <div
                    key={row.id}
                    role="link"
                    tabIndex={0}
                    draggable={movable}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", row.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDragUndated(row.id);
                    }}
                    onDragEnd={() => {
                      setDragUndated(null);
                      setDropDay(null);
                    }}
                    onClick={() => open(row)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") open(row);
                    }}
                    className={cn(
                      "board-card flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-xs",
                      dragUndated === row.id && "opacity-40",
                    )}
                  >
                    <PageIcon icon={row.icon} className="shrink-0 text-xs" />
                    <span className={cn("truncate font-medium", !row.title && "text-fg-faint")}>
                      {pageLabel(row.title, tc("untitled"))}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );

  function laneName(group: RowGroup<Row>) {
    if (group.person) return group.person.name || t("person.unknown");
    return group.option?.name ?? t("board.noValue", { property: groupBy?.name ?? "" });
  }
}
