"use client";

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarDays,
  ChevronDown,
  Eye,
  EyeOff,
  ListFilter,
  Pencil,
  Plus,
  Rows3,
  Trash2,
  X,
} from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button, cn, Input, MenuItem, MenuSeparator } from "@/components/ui";
import type { FilterOp, FilterRule, SortRule, ViewConfig, ViewType } from "@/db/schema/app";
import { pageLabel } from "@/lib/labels";
import { filterNeedsValue, filterOperators, isHiddenInView, isSortable, toggleHiddenInView } from "@/lib/properties";
import { Floating, useFloating } from "./floating";
import { useFormatDate } from "./property-cell";
import { PropertyTypeIcon, ViewIcon } from "./property-icons";
import { linkedRows, useRelations } from "./relation-context";
import { TITLE, type Property, type View } from "./types";

export const VIEW_TYPES = ["table", "board", "calendar"] as const satisfies readonly ViewType[];
export { ViewIcon };

export function ViewTabs({
  views,
  activeId,
  onSelect,
  onAdd,
  onRename,
  onDelete,
  readOnly,
}: {
  views: View[];
  activeId: string;
  onSelect: (id: string) => void;
  onAdd: (type: ViewType) => void;
  onRename: (view: View, name: string) => void;
  onDelete: (view: View) => void;
  readOnly?: boolean;
}) {
  const t = useTranslations("database");
  const add = useFloating<HTMLButtonElement>();
  return (
    <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
      {views.map((view) => (
        <ViewTab
          key={view.id}
          view={view}
          active={view.id === activeId}
          canDelete={views.length > 1}
          readOnly={readOnly}
          onSelect={() => onSelect(view.id)}
          onRename={(name) => onRename(view, name)}
          onDelete={() => onDelete(view)}
        />
      ))}
      {!readOnly && (
        <>
          <button
            ref={add.ref}
            type="button"
            aria-label={t("viewTabs.addView")}
            title={t("viewTabs.addView")}
            onClick={add.toggle}
            className="mb-1.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-bg-hover hover:text-fg"
          >
            <Plus className="h-4 w-4" />
          </button>
          <Floating open={add.open} anchor={add.el} onClose={add.close}>
            <div className="px-2 pt-1 pb-1.5 text-xs text-fg-muted">{t("viewTabs.addViewHeading")}</div>
            {VIEW_TYPES.map((type) => (
              <MenuItem
                key={type}
                icon={<ViewIcon type={type} />}
                onClick={() => {
                  add.close();
                  onAdd(type);
                }}
              >
                {t(`views.${type}`)}
              </MenuItem>
            ))}
          </Floating>
        </>
      )}
    </div>
  );
}

function ViewTab({
  view,
  active,
  canDelete,
  readOnly,
  onSelect,
  onRename,
  onDelete,
}: {
  view: View;
  active: boolean;
  canDelete: boolean;
  readOnly?: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const t = useTranslations("database.viewTabs");
  const menu = useFloating<HTMLButtonElement>();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(view.name);

  return (
    <div className={cn("flex shrink-0 items-center border-b-2 pb-1", active ? "border-fg" : "border-transparent")}>
      <button
        ref={menu.ref}
        type="button"
        onClick={() => (active && !readOnly ? menu.toggle() : onSelect())}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-sm hover:bg-bg-hover",
          active ? "font-medium text-fg" : "text-fg-muted",
        )}
      >
        <ViewIcon type={view.type} />
        <span className="max-w-40 truncate">{view.name}</span>
        {active && !readOnly && <ChevronDown className="h-3 w-3 text-fg-faint" />}
      </button>
      <Floating
        open={menu.open}
        anchor={menu.el}
        onClose={() => {
          menu.close();
          setRenaming(false);
        }}
      >
        {renaming ? (
          <div className="w-56 p-1">
            <Input
              autoFocus
              value={name}
              aria-label={t("viewName")}
              className="h-7"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (name.trim()) onRename(name.trim());
                  setRenaming(false);
                  menu.close();
                }
              }}
            />
          </div>
        ) : (
          <>
            <MenuItem
              icon={<Pencil className="h-3.5 w-3.5" />}
              onClick={() => {
                setName(view.name);
                setRenaming(true);
              }}
            >
              {t("rename")}
            </MenuItem>
            {canDelete && (
              <>
                <MenuSeparator />
                <MenuItem
                  danger
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  onClick={() => {
                    menu.close();
                    onDelete();
                  }}
                >
                  {t("deleteView")}
                </MenuItem>
              </>
            )}
          </>
        )}
      </Floating>
    </div>
  );
}

type Column = { id: string; name: string; type: Property["type"] | "title"; prop: Property | null };

function columnsOf(properties: Property[], titleName: string): Column[] {
  return [
    { id: TITLE, name: titleName, type: "title", prop: null },
    ...properties.map((p) => ({ id: p.id, name: p.name, type: p.type, prop: p })),
  ];
}

function ToolbarButton({
  icon,
  label,
  count,
  active,
  buttonRef,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  active?: boolean;
  buttonRef?: (el: HTMLButtonElement | null) => void;
  onClick: () => void;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-md px-1.5 text-sm hover:bg-bg-hover",
        active ? "text-accent" : "text-fg-muted hover:text-fg",
      )}
    >
      {icon}
      {count ? <span className="text-xs tabular-nums">{count}</span> : null}
    </button>
  );
}

/** Filter, sort, group and property visibility controls for the active view. */
export function ViewToolbar({
  view,
  properties,
  onConfig,
  onCreateGroupProperty,
  onCreateDateProperty,
  readOnly,
  locked,
}: {
  view: View;
  properties: Property[];
  onConfig: (config: ViewConfig) => void;
  onCreateGroupProperty: () => void;
  onCreateDateProperty: () => void;
  readOnly?: boolean;
  /** The schema is locked: no creating properties from the group and calendar menus. */
  locked?: boolean;
}) {
  const t = useTranslations("database");
  const filterMenu = useFloating<HTMLButtonElement>();
  const sortMenu = useFloating<HTMLButtonElement>();
  const groupMenu = useFloating<HTMLButtonElement>();
  const propsMenu = useFloating<HTMLButtonElement>();
  const config = view.config;
  const filters = config.filters ?? [];
  const sorts = config.sorts ?? [];
  const hiddenCount = properties.filter((p) => isHiddenInView(view, p)).length;
  const columns = columnsOf(properties, t("nameColumn"));
  const selectProps = properties.filter((p) => p.type === "select");
  const groupBy = selectProps.find((p) => p.id === config.groupBy) ?? selectProps[0];
  const dateMenu = useFloating<HTMLButtonElement>();
  const dateProps = properties.filter((p) => p.type === "date");
  const dateBy = dateProps.find((p) => p.id === config.dateBy) ?? dateProps[0];

  if (readOnly) return null;
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <ToolbarButton
        icon={<ListFilter className="h-4 w-4" />}
        label={t("toolbar.filter")}
        count={filters.length}
        active={filters.length > 0}
        buttonRef={filterMenu.ref}
        onClick={filterMenu.toggle}
      />
      <Floating open={filterMenu.open} anchor={filterMenu.el} onClose={filterMenu.close} align="end">
        <FilterEditor columns={columns} filters={filters} onChange={(f) => onConfig({ ...config, filters: f })} />
      </Floating>

      <ToolbarButton
        icon={<ArrowUpDown className="h-4 w-4" />}
        label={t("toolbar.sort")}
        count={sorts.length}
        active={sorts.length > 0}
        buttonRef={sortMenu.ref}
        onClick={sortMenu.toggle}
      />
      <Floating open={sortMenu.open} anchor={sortMenu.el} onClose={sortMenu.close} align="end">
        <SortEditor
          columns={columns.filter((c) => isSortable(c.type))}
          sorts={sorts}
          onChange={(s) => onConfig({ ...config, sorts: s })}
        />
      </Floating>

      {view.type === "board" && (
        <>
          <ToolbarButton
            icon={<Rows3 className="h-4 w-4" />}
            label={groupBy ? t("toolbar.groupWithName", { name: groupBy.name }) : t("toolbar.group")}
            buttonRef={groupMenu.ref}
            onClick={groupMenu.toggle}
          />
          <Floating open={groupMenu.open} anchor={groupMenu.el} onClose={groupMenu.close} align="end">
            <div className="px-2 pt-1 pb-1.5 text-xs text-fg-muted">{t("toolbar.groupBy")}</div>
            {selectProps.map((p) => (
              <MenuItem
                key={p.id}
                active={p.id === groupBy?.id}
                icon={<PropertyTypeIcon type={p.type} />}
                onClick={() => {
                  groupMenu.close();
                  onConfig({ ...config, groupBy: p.id });
                }}
              >
                {p.name}
              </MenuItem>
            ))}
            {!selectProps.length && (
              <div className="px-2 pb-1 text-xs text-fg-faint">{t("toolbar.groupNeedsSelect")}</div>
            )}
            {!locked && (
              <>
                <MenuSeparator />
                <MenuItem
                  icon={<Plus className="h-3.5 w-3.5" />}
                  onClick={() => {
                    groupMenu.close();
                    onCreateGroupProperty();
                  }}
                >
                  {t("toolbar.newSelectProperty")}
                </MenuItem>
              </>
            )}
          </Floating>
        </>
      )}

      {view.type === "calendar" && (
        <>
          <ToolbarButton
            icon={<CalendarDays className="h-4 w-4" />}
            label={dateBy ? t("toolbar.calendarWithName", { name: dateBy.name }) : t("toolbar.calendarBy")}
            buttonRef={dateMenu.ref}
            onClick={dateMenu.toggle}
          />
          <Floating open={dateMenu.open} anchor={dateMenu.el} onClose={dateMenu.close} align="end">
            <div className="px-2 pt-1 pb-1.5 text-xs text-fg-muted">{t("toolbar.calendarBy")}</div>
            {dateProps.map((p) => (
              <MenuItem
                key={p.id}
                active={p.id === dateBy?.id}
                icon={<PropertyTypeIcon type={p.type} />}
                onClick={() => {
                  dateMenu.close();
                  onConfig({ ...config, dateBy: p.id });
                }}
              >
                {p.name}
              </MenuItem>
            ))}
            {!dateProps.length && (
              <div className="px-2 pb-1 text-xs text-fg-faint">{t("toolbar.calendarNeedsDate")}</div>
            )}
            {!locked && (
              <>
                <MenuSeparator />
                <MenuItem
                  icon={<Plus className="h-3.5 w-3.5" />}
                  onClick={() => {
                    dateMenu.close();
                    onCreateDateProperty();
                  }}
                >
                  {t("toolbar.newDateProperty")}
                </MenuItem>
              </>
            )}
          </Floating>
        </>
      )}

      <ToolbarButton
        icon={<EyeOff className="h-4 w-4" />}
        label={t("toolbar.properties")}
        count={hiddenCount || undefined}
        buttonRef={propsMenu.ref}
        onClick={propsMenu.toggle}
      />
      <Floating open={propsMenu.open} anchor={propsMenu.el} onClose={propsMenu.close} align="end">
        <div className="w-60">
          <div className="px-2 pt-1 pb-1.5 text-xs text-fg-muted">{t("toolbar.shownInView")}</div>
          {!properties.length && <div className="px-2 pb-1.5 text-xs text-fg-faint">{t("toolbar.noProperties")}</div>}
          {properties.map((p) => {
            const isHidden = isHiddenInView(view, p);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onConfig(toggleHiddenInView(view, p))}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-bg-hover"
              >
                <PropertyTypeIcon type={p.type} className="h-3.5 w-3.5 text-fg-muted" />
                <span className={cn("flex-1 truncate", isHidden && "text-fg-faint")}>{p.name}</span>
                {isHidden ? (
                  <EyeOff className="h-3.5 w-3.5 text-fg-faint" aria-label={t("toolbar.hidden")} />
                ) : (
                  <Eye className="h-3.5 w-3.5 text-fg-muted" aria-label={t("toolbar.shown")} />
                )}
              </button>
            );
          })}
        </div>
      </Floating>
    </div>
  );
}

/** Summary line under the tabs when the view filters or sorts, with a quick clear. */
export function ActiveRulesBar({
  view,
  properties,
  onConfig,
  readOnly,
}: {
  view: View;
  properties: Property[];
  onConfig: (config: ViewConfig) => void;
  readOnly?: boolean;
}) {
  const t = useTranslations("database");
  const describeFilter = useDescribeFilter();
  const filters = view.config.filters ?? [];
  const sorts = view.config.sorts ?? [];
  if (!filters.length && !sorts.length) return null;
  const columns = columnsOf(properties, t("nameColumn"));
  const nameOf = (id: string) => columns.find((c) => c.id === id)?.name ?? t("activeRules.unknownProperty");
  return (
    <div className="flex flex-wrap items-center gap-1.5 py-1.5 text-xs">
      {sorts.map((s) => (
        <span
          key={`s-${s.propertyId}`}
          title={t(s.direction === "asc" ? "activeRules.sortedAscending" : "activeRules.sortedDescending", {
            property: nameOf(s.propertyId),
          })}
          className="inline-flex h-6 items-center gap-1 rounded-md border border-border px-1.5 text-fg-muted"
        >
          {s.direction === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          {nameOf(s.propertyId)}
        </span>
      ))}
      {filters.map((f, i) => (
        <span key={`f-${i}`} className="inline-flex h-6 items-center gap-1 rounded-md border border-border px-1.5 text-fg-muted">
          <ListFilter className="h-3 w-3" />
          {describeFilter(f, columns)}
        </span>
      ))}
      {!readOnly && (
        <button
          type="button"
          onClick={() => onConfig({ ...view.config, filters: [], sorts: [] })}
          className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-fg-muted hover:bg-bg-hover hover:text-fg"
        >
          <X className="h-3 w-3" />
          {t("activeRules.clear")}
        </button>
      )}
    </div>
  );
}

/** Translated operator label for a filter rule (falls back to the raw op). */
function useOperatorLabel() {
  const t = useTranslations("database.filter.ops");
  return (type: Column["type"], op: FilterOp) => {
    const label = filterOperators(type).find((o) => o.op === op)?.label;
    return label ? t(label) : op;
  };
}

/** One-line summary of a filter rule, e.g. "Status is Done", in the UI language. */
function useDescribeFilter() {
  const t = useTranslations("database.activeRules");
  const locale = useLocale();
  const format = useFormatter();
  const formatDate = useFormatDate();
  const operatorLabel = useOperatorLabel();
  const relations = useRelations();
  const tc = useTranslations("common");
  return (f: FilterRule, columns: Column[]) => {
    const col = columns.find((c) => c.id === f.propertyId);
    if (!col) return t("unknownFilter");
    const operator = operatorLabel(col.type, f.op).toLocaleLowerCase(locale);
    if (!filterNeedsValue(f.op) || col.type === "checkbox") {
      return t("filterWithoutValue", { property: col.name, operator });
    }
    let value = String(f.value ?? "");
    if (col.prop && (col.type === "select" || col.type === "multi_select")) {
      value = col.prop.options.options?.find((o) => o.id === f.value)?.name ?? "…";
    } else if (col.prop && col.type === "relation") {
      const row = linkedRows(relations?.targets[col.prop.id], [f.value])[0];
      value = row ? pageLabel(row.title, tc("untitled")) : "…";
    } else if (col.type === "number" && typeof f.value === "number") {
      value = format.number(f.value, { maximumFractionDigits: 10 });
    } else if (col.type === "date" && value) {
      value = formatDate(value);
    }
    return t("filterWithValue", { property: col.name, operator, value: value || "…" });
  };
}

function FilterEditor({
  columns,
  filters,
  onChange,
}: {
  columns: Column[];
  filters: FilterRule[];
  onChange: (filters: FilterRule[]) => void;
}) {
  const t = useTranslations("database.filter");
  const operatorLabel = useOperatorLabel();
  // Text values are drafted locally and saved with a short debounce.
  const [draft, setDraft] = useState(filters);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(draft);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        onChangeRef.current(latest.current);
      }
    },
    [],
  );

  const update = (next: FilterRule[], debounce = false) => {
    setDraft(next);
    latest.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (debounce) {
      timer.current = setTimeout(() => {
        timer.current = null;
        onChange(next);
      }, 400);
    } else onChange(next);
  };

  const defaultRule = (col: Column): FilterRule => ({ propertyId: col.id, op: filterOperators(col.type)[0].op });

  return (
    <div className="w-[26rem] max-w-[calc(100vw-2rem)] p-1">
      {!draft.length && <div className="px-2 py-1.5 text-xs text-fg-faint">{t("empty")}</div>}
      {draft.map((rule, i) => {
        const col = columns.find((c) => c.id === rule.propertyId) ?? columns[0];
        const ops = filterOperators(col.type);
        const set = (patch: Partial<FilterRule>, debounce = false) =>
          update(
            draft.map((r, j) => (j === i ? { ...r, ...patch } : r)),
            debounce,
          );
        return (
          <div key={i} className="flex items-center gap-1 px-1 py-1">
            <NativeSelect
              label={t("property")}
              value={col.id}
              onChange={(id) => {
                const next = columns.find((c) => c.id === id);
                if (next) update(draft.map((r, j) => (j === i ? defaultRule(next) : r)));
              }}
              options={columns.map((c) => ({ value: c.id, label: c.name }))}
              className="w-32"
            />
            <NativeSelect
              label={t("condition")}
              value={rule.op}
              onChange={(op) => set({ op: op as FilterOp })}
              options={ops.map((o) => ({ value: o.op, label: operatorLabel(col.type, o.op) }))}
              className="w-32"
            />
            <div className="min-w-0 flex-1">
              {filterNeedsValue(rule.op) && col.type !== "checkbox" && (
                <FilterValue col={col} value={rule.value} onChange={(value, debounce) => set({ value }, debounce)} />
              )}
            </div>
            <button
              type="button"
              aria-label={t("remove")}
              onClick={() => update(draft.filter((_, j) => j !== i))}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-bg-hover hover:text-fg"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
      <MenuSeparator />
      <div className="flex items-center justify-between">
        <MenuItemInline onClick={() => update([...draft, defaultRule(columns[0])])} icon={<Plus className="h-3.5 w-3.5" />}>
          {t("add")}
        </MenuItemInline>
        {draft.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => update([])}>
            {t("clearAll")}
          </Button>
        )}
      </div>
    </div>
  );
}

function FilterValue({
  col,
  value,
  onChange,
}: {
  col: Column;
  value: unknown;
  onChange: (value: unknown, debounce?: boolean) => void;
}) {
  const t = useTranslations("database.filter");
  const tc = useTranslations("common");
  const relations = useRelations();
  if (col.type === "relation" && col.prop) {
    const rows = relations?.targets[col.prop.id]?.rows ?? [];
    return (
      <NativeSelect
        label={t("value")}
        value={typeof value === "string" ? value : ""}
        onChange={(v) => onChange(v || undefined)}
        options={[{ value: "", label: t("choose") }, ...rows.map((r) => ({ value: r.id, label: pageLabel(r.title, tc("untitled")) }))]}
        className="w-full"
      />
    );
  }
  if ((col.type === "select" || col.type === "multi_select") && col.prop) {
    const options = col.prop.options.options ?? [];
    return (
      <NativeSelect
        label={t("value")}
        value={typeof value === "string" ? value : ""}
        onChange={(v) => onChange(v || undefined)}
        options={[{ value: "", label: t("choose") }, ...options.map((o) => ({ value: o.id, label: o.name }))]}
        className="w-full"
      />
    );
  }
  if (col.type === "date") {
    return (
      <Input
        type="date"
        aria-label={t("value")}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value || undefined)}
        className="h-7 [color-scheme:light_dark]"
      />
    );
  }
  return (
    <Input
      aria-label={t("value")}
      type={col.type === "number" ? "number" : "text"}
      value={value === undefined || value === null ? "" : String(value)}
      placeholder={t("value")}
      onChange={(e) => {
        const raw = e.target.value;
        onChange(col.type === "number" ? (raw === "" ? undefined : Number(raw)) : raw, true);
      }}
      className="h-7"
    />
  );
}

function SortEditor({
  columns,
  sorts,
  onChange,
}: {
  columns: Column[];
  sorts: SortRule[];
  onChange: (sorts: SortRule[]) => void;
}) {
  const t = useTranslations("database.sort");
  const unused = columns.filter((c) => !sorts.some((s) => s.propertyId === c.id));
  return (
    <div className="w-80 max-w-[calc(100vw-2rem)] p-1">
      {!sorts.length && <div className="px-2 py-1.5 text-xs text-fg-faint">{t("empty")}</div>}
      {sorts.map((rule, i) => (
        <div key={rule.propertyId} className="flex items-center gap-1 px-1 py-1">
          <NativeSelect
            label={t("property")}
            value={rule.propertyId}
            onChange={(id) => onChange(sorts.map((s, j) => (j === i ? { ...s, propertyId: id } : s)))}
            options={columns
              .filter((c) => c.id === rule.propertyId || !sorts.some((s) => s.propertyId === c.id))
              .map((c) => ({ value: c.id, label: c.name }))}
            className="flex-1"
          />
          <NativeSelect
            label={t("direction")}
            value={rule.direction}
            onChange={(d) => onChange(sorts.map((s, j) => (j === i ? { ...s, direction: d as "asc" | "desc" } : s)))}
            options={[
              { value: "asc", label: t("ascending") },
              { value: "desc", label: t("descending") },
            ]}
            className="w-32"
          />
          <button
            type="button"
            aria-label={t("remove")}
            onClick={() => onChange(sorts.filter((_, j) => j !== i))}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-bg-hover hover:text-fg"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <MenuSeparator />
      <div className="flex items-center justify-between">
        {unused.length > 0 ? (
          <MenuItemInline
            icon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => onChange([...sorts, { propertyId: unused[0].id, direction: "asc" }])}
          >
            {t("add")}
          </MenuItemInline>
        ) : (
          <span />
        )}
        {sorts.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => onChange([])}>
            {t("clearAll")}
          </Button>
        )}
      </div>
    </div>
  );
}

function MenuItemInline({ icon, children, onClick }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-sm text-fg-muted hover:bg-bg-hover hover:text-fg"
    >
      {icon}
      {children}
    </button>
  );
}

function NativeSelect({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-7 min-w-0 rounded-md border border-border bg-bg px-1.5 text-sm outline-none focus:border-accent",
        className,
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
