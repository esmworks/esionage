"use client";

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  Eye,
  EyeOff,
  Kanban,
  ListFilter,
  Pencil,
  Plus,
  Rows3,
  Sheet,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, cn, Input, MenuItem, MenuSeparator } from "@/components/ui";
import type { FilterOp, FilterRule, SortRule, ViewConfig, ViewType } from "@/db/schema/app";
import { filterNeedsValue, filterOperators } from "@/lib/properties";
import { Floating, useFloating } from "./floating";
import { PropertyTypeIcon } from "./property-icons";
import { TITLE, type Property, type View } from "./types";

export function ViewIcon({ type, className }: { type: ViewType; className?: string }) {
  const Icon = type === "board" ? Kanban : Sheet;
  return <Icon className={className ?? "h-3.5 w-3.5"} strokeWidth={1.75} aria-hidden />;
}

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
            aria-label="Add view"
            title="Add view"
            onClick={add.toggle}
            className="mb-1.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-bg-hover hover:text-fg"
          >
            <Plus className="h-4 w-4" />
          </button>
          <Floating open={add.open} anchor={add.el} onClose={add.close}>
            <div className="px-2 pt-1 pb-1.5 text-xs text-fg-muted">Add a view</div>
            {(["table", "board"] as const).map((type) => (
              <MenuItem
                key={type}
                icon={<ViewIcon type={type} />}
                onClick={() => {
                  add.close();
                  onAdd(type);
                }}
              >
                {type === "board" ? "Board" : "Table"}
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
              aria-label="View name"
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
              Rename
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
                  Delete view
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

function columnsOf(properties: Property[]): Column[] {
  return [
    { id: TITLE, name: "Name", type: "title", prop: null },
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
        "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-sm hover:bg-bg-hover",
        active ? "text-accent" : "text-fg-muted hover:text-fg",
      )}
    >
      {icon}
      <span className="hidden @2xl:inline">{label}</span>
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
  readOnly,
}: {
  view: View;
  properties: Property[];
  onConfig: (config: ViewConfig) => void;
  onCreateGroupProperty: () => void;
  readOnly?: boolean;
}) {
  const filterMenu = useFloating<HTMLButtonElement>();
  const sortMenu = useFloating<HTMLButtonElement>();
  const groupMenu = useFloating<HTMLButtonElement>();
  const propsMenu = useFloating<HTMLButtonElement>();
  const config = view.config;
  const filters = config.filters ?? [];
  const sorts = config.sorts ?? [];
  const hidden = new Set(config.hidden ?? []);
  const columns = columnsOf(properties);
  const selectProps = properties.filter((p) => p.type === "select");
  const groupBy = selectProps.find((p) => p.id === config.groupBy) ?? selectProps[0];

  if (readOnly) return null;
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <ToolbarButton
        icon={<ListFilter className="h-3.5 w-3.5" />}
        label="Filter"
        count={filters.length}
        active={filters.length > 0}
        buttonRef={filterMenu.ref}
        onClick={filterMenu.toggle}
      />
      <Floating open={filterMenu.open} anchor={filterMenu.el} onClose={filterMenu.close} align="end">
        <FilterEditor columns={columns} filters={filters} onChange={(f) => onConfig({ ...config, filters: f })} />
      </Floating>

      <ToolbarButton
        icon={<ArrowUpDown className="h-3.5 w-3.5" />}
        label="Sort"
        count={sorts.length}
        active={sorts.length > 0}
        buttonRef={sortMenu.ref}
        onClick={sortMenu.toggle}
      />
      <Floating open={sortMenu.open} anchor={sortMenu.el} onClose={sortMenu.close} align="end">
        <SortEditor columns={columns} sorts={sorts} onChange={(s) => onConfig({ ...config, sorts: s })} />
      </Floating>

      {view.type === "board" && (
        <>
          <ToolbarButton
            icon={<Rows3 className="h-3.5 w-3.5" />}
            label={groupBy ? `Group: ${groupBy.name}` : "Group"}
            buttonRef={groupMenu.ref}
            onClick={groupMenu.toggle}
          />
          <Floating open={groupMenu.open} anchor={groupMenu.el} onClose={groupMenu.close} align="end">
            <div className="px-2 pt-1 pb-1.5 text-xs text-fg-muted">Group by</div>
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
              <div className="px-2 pb-1 text-xs text-fg-faint">Boards group by a select property.</div>
            )}
            <MenuSeparator />
            <MenuItem
              icon={<Plus className="h-3.5 w-3.5" />}
              onClick={() => {
                groupMenu.close();
                onCreateGroupProperty();
              }}
            >
              New select property
            </MenuItem>
          </Floating>
        </>
      )}

      <ToolbarButton
        icon={<EyeOff className="h-3.5 w-3.5" />}
        label="Properties"
        count={hidden.size || undefined}
        buttonRef={propsMenu.ref}
        onClick={propsMenu.toggle}
      />
      <Floating open={propsMenu.open} anchor={propsMenu.el} onClose={propsMenu.close} align="end">
        <div className="w-60">
          <div className="px-2 pt-1 pb-1.5 text-xs text-fg-muted">Shown in this view</div>
          {!properties.length && <div className="px-2 pb-1.5 text-xs text-fg-faint">No properties yet</div>}
          {properties.map((p) => {
            const isHidden = hidden.has(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() =>
                  onConfig({
                    ...config,
                    hidden: isHidden ? [...hidden].filter((h) => h !== p.id) : [...hidden, p.id],
                  })
                }
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-bg-hover"
              >
                <PropertyTypeIcon type={p.type} className="h-3.5 w-3.5 text-fg-muted" />
                <span className={cn("flex-1 truncate", isHidden && "text-fg-faint")}>{p.name}</span>
                {isHidden ? (
                  <EyeOff className="h-3.5 w-3.5 text-fg-faint" aria-label="Hidden" />
                ) : (
                  <Eye className="h-3.5 w-3.5 text-fg-muted" aria-label="Shown" />
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
  const filters = view.config.filters ?? [];
  const sorts = view.config.sorts ?? [];
  if (!filters.length && !sorts.length) return null;
  const columns = columnsOf(properties);
  const nameOf = (id: string) => columns.find((c) => c.id === id)?.name ?? "Unknown";
  return (
    <div className="flex flex-wrap items-center gap-1.5 py-1.5 text-xs">
      {sorts.map((s) => (
        <span key={`s-${s.propertyId}`} className="inline-flex h-6 items-center gap-1 rounded-md border border-border px-1.5 text-fg-muted">
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
          Clear
        </button>
      )}
    </div>
  );
}

function describeFilter(f: FilterRule, columns: Column[]) {
  const col = columns.find((c) => c.id === f.propertyId);
  if (!col) return "Unknown filter";
  const op = filterOperators(col.type).find((o) => o.op === f.op)?.label ?? f.op;
  if (!filterNeedsValue(f.op) || col.type === "checkbox") return `${col.name} ${op.toLowerCase()}`;
  let value = String(f.value ?? "");
  if (col.prop && (col.type === "select" || col.type === "multi_select")) {
    value = col.prop.options.options?.find((o) => o.id === f.value)?.name ?? "…";
  }
  return `${col.name} ${op.toLowerCase()} ${value || "…"}`;
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
      {!draft.length && <div className="px-2 py-1.5 text-xs text-fg-faint">No filters applied to this view</div>}
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
              label="Property"
              value={col.id}
              onChange={(id) => {
                const next = columns.find((c) => c.id === id);
                if (next) update(draft.map((r, j) => (j === i ? defaultRule(next) : r)));
              }}
              options={columns.map((c) => ({ value: c.id, label: c.name }))}
              className="w-32"
            />
            <NativeSelect
              label="Condition"
              value={rule.op}
              onChange={(op) => set({ op: op as FilterOp })}
              options={ops.map((o) => ({ value: o.op, label: o.label }))}
              className="w-32"
            />
            <div className="min-w-0 flex-1">
              {filterNeedsValue(rule.op) && col.type !== "checkbox" && (
                <FilterValue col={col} value={rule.value} onChange={(value, debounce) => set({ value }, debounce)} />
              )}
            </div>
            <button
              type="button"
              aria-label="Remove filter"
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
          Add filter
        </MenuItemInline>
        {draft.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => update([])}>
            Clear all
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
  if ((col.type === "select" || col.type === "multi_select") && col.prop) {
    const options = col.prop.options.options ?? [];
    return (
      <NativeSelect
        label="Value"
        value={typeof value === "string" ? value : ""}
        onChange={(v) => onChange(v || undefined)}
        options={[{ value: "", label: "Choose…" }, ...options.map((o) => ({ value: o.id, label: o.name }))]}
        className="w-full"
      />
    );
  }
  if (col.type === "date") {
    return (
      <Input
        type="date"
        aria-label="Value"
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value || undefined)}
        className="h-7 [color-scheme:light_dark]"
      />
    );
  }
  return (
    <Input
      aria-label="Value"
      type={col.type === "number" ? "number" : "text"}
      value={value === undefined || value === null ? "" : String(value)}
      placeholder="Value"
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
  const unused = columns.filter((c) => !sorts.some((s) => s.propertyId === c.id));
  return (
    <div className="w-80 max-w-[calc(100vw-2rem)] p-1">
      {!sorts.length && <div className="px-2 py-1.5 text-xs text-fg-faint">No sorts applied to this view</div>}
      {sorts.map((rule, i) => (
        <div key={rule.propertyId} className="flex items-center gap-1 px-1 py-1">
          <NativeSelect
            label="Property"
            value={rule.propertyId}
            onChange={(id) => onChange(sorts.map((s, j) => (j === i ? { ...s, propertyId: id } : s)))}
            options={columns
              .filter((c) => c.id === rule.propertyId || !sorts.some((s) => s.propertyId === c.id))
              .map((c) => ({ value: c.id, label: c.name }))}
            className="flex-1"
          />
          <NativeSelect
            label="Direction"
            value={rule.direction}
            onChange={(d) => onChange(sorts.map((s, j) => (j === i ? { ...s, direction: d as "asc" | "desc" } : s)))}
            options={[
              { value: "asc", label: "Ascending" },
              { value: "desc", label: "Descending" },
            ]}
            className="w-32"
          />
          <button
            type="button"
            aria-label="Remove sort"
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
            Add sort
          </MenuItemInline>
        ) : (
          <span />
        )}
        {sorts.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => onChange([])}>
            Clear all
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
