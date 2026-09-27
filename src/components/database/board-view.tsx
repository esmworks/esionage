"use client";

import { Ellipsis, ExternalLink, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { Button, cn, MenuItem, MenuSeparator } from "@/components/ui";
import { pageLabel } from "@/lib/labels";
import { groupRows, isHiddenInView, orderGroups, positionBetween, type RowGroup } from "@/lib/properties";
import { Floating, useFloating } from "./floating";
import { isEmptyValue, OptionChip, PropertyDisplay } from "./property-cell";
import { TITLE, type Property, type Row, type View } from "./types";
import type { DatabaseApi } from "./use-database";

export function BoardView({
  workspaceId,
  view,
  properties,
  rows,
  api,
  readOnly,
  onCreateGroupProperty,
}: {
  workspaceId: string;
  view: View;
  properties: Property[];
  rows: Row[];
  api: DatabaseApi;
  readOnly?: boolean;
  onCreateGroupProperty: () => void;
}) {
  const t = useTranslations("database");
  const selectProps = properties.filter((p) => p.type === "select");
  const groupBy = selectProps.find((p) => p.id === view.config.groupBy) ?? selectProps[0];
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ group: string; index: number } | null>(null);
  const [editTitleOf, setEditTitleOf] = useState<string | null>(null);
  // Column drag: the dragged column's key and the insertion index among the shown columns.
  const [dragCol, setDragCol] = useState<string | null>(null);
  const [colDrop, setColDrop] = useState<number | null>(null);

  if (!groupBy) {
    return (
      <div className="page-gutter">
        <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border px-6 py-10">
          <div>
            <p className="text-sm font-medium">{t("board.needsSelectTitle")}</p>
            <p className="mt-1 text-sm text-fg-muted">{t("board.needsSelectBody")}</p>
          </div>
          {!readOnly && (
            <Button size="sm" onClick={onCreateGroupProperty}>
              <Plus className="h-3.5 w-3.5" />
              {t("board.addGroupProperty", { name: t("page.defaultGroupProperty") })}
            </Button>
          )}
        </div>
      </div>
    );
  }

  const cardProps = properties.filter((p) => p.id !== groupBy.id && !isHiddenInView(view, p));
  const groupKey = (g: RowGroup<Row>) => g.option?.id ?? "";
  const ordered = orderGroups(groupRows(rows, groupBy), view.config.groupOrder);
  // The "no value" column only earns space when it has cards; while dragging a card it appears at
  // the end (so the other columns don't shift) as a place to clear the value.
  const noValue = ordered.find((g) => !g.option)!;
  const groups = ordered.filter((g) => g.option || g.rows.length);
  if (dragId && !noValue.rows.length) groups.push(noValue);
  const manualOrder = !(view.config.sorts?.length);

  const onColDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (dragCol === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const cols = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-col]")];
    let index = cols.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return e.clientX < r.left + r.width / 2;
    });
    if (index === -1) index = cols.length;
    if (index !== colDrop) setColDrop(index);
  };

  const onColDrop = (e: DragEvent<HTMLDivElement>) => {
    if (dragCol === null) return;
    e.preventDefault();
    const moved = dragCol;
    const at = colDrop;
    setDragCol(null);
    setColDrop(null);
    const shown = groups.map(groupKey);
    const from = shown.indexOf(moved);
    if (at === null || from === -1 || at === from || at === from + 1) return;
    // Place it before the column it was dropped in front of; columns that aren't shown (an empty
    // "no value") keep their place in the saved order.
    const before = shown[at];
    const order = ordered.map(groupKey).filter((k) => k !== moved);
    const i = before === undefined ? order.length : order.indexOf(before);
    order.splice(i, 0, moved);
    void api.updateView(view, { config: { ...view.config, groupOrder: order } });
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>, group: RowGroup<Row>) => {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const cards = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-card]")].filter(
      (el) => el.dataset.card !== dragId,
    );
    let index = cards.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    if (index === -1) index = cards.length;
    const key = groupKey(group);
    if (drop?.group !== key || drop.index !== index) setDrop({ group: key, index });
  };

  const onDrop = (e: DragEvent<HTMLDivElement>, group: RowGroup<Row>) => {
    if (dragCol !== null) return;
    e.preventDefault();
    const rowId = dragId ?? e.dataTransfer.getData("text/plain");
    const index = drop?.group === groupKey(group) ? drop.index : group.rows.length;
    setDragId(null);
    setDrop(null);
    const row = rows.find((r) => r.id === rowId);
    if (!row) return;
    const others = group.rows.filter((r) => r.id !== rowId);
    const sameGroup = group.rows.some((r) => r.id === rowId);
    const move: { position?: number; groupBy?: string; groupValue?: string | null } = {};
    if (!sameGroup) {
      move.groupBy = groupBy.id;
      move.groupValue = group.option?.id ?? null;
    }
    if (manualOrder) {
      const position = positionBetween(others[index - 1]?.position, others[index]?.position);
      const currentIndex = group.rows.findIndex((r) => r.id === rowId);
      if (!sameGroup || currentIndex !== index) move.position = position;
    }
    if (move.position === undefined && move.groupBy === undefined) return;
    void api.moveRow(rowId, move);
  };

  const addCard = async (group: RowGroup<Row>) => {
    const id = await api.createRow(group.option ? { properties: { [groupBy.id]: group.option.id } } : {});
    if (id) setEditTitleOf(id);
  };

  return (
    <div className="page-gutter overflow-x-auto pb-6 [color-scheme:light_dark]">
      <div
        className="flex w-max items-start gap-3"
        onDragOver={onColDragOver}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setColDrop(null);
        }}
        onDrop={onColDrop}
      >
        {groups.map((group, i) => {
          const key = groupKey(group);
          const dropping = dragId !== null && drop?.group === key;
          const colFrom = dragCol === null ? -1 : groups.findIndex((g) => groupKey(g) === dragCol);
          const lineAt = colDrop !== null && colDrop !== colFrom && colDrop !== colFrom + 1 ? colDrop : null;
          return (
            <section
              key={key || "__none"}
              data-col={key}
              aria-label={group.option?.name ?? t("board.noValue", { property: groupBy.name })}
              className={cn(
                `tint-${group.option?.color ?? "gray"}`,
                "group/col relative flex w-[17rem] shrink-0 flex-col rounded-xl bg-[var(--opt-tint)] p-2 transition-[box-shadow,opacity]",
                dropping && "ring-2 ring-accent/50",
                dragCol === key && "opacity-50",
              )}
            >
              {lineAt === i && <ColumnDropLine side="left" />}
              {lineAt === groups.length && i === groups.length - 1 && <ColumnDropLine side="right" />}
              <header
                draggable={!readOnly}
                title={readOnly ? undefined : t("board.moveColumn")}
                onDragStart={(e) => {
                  const col = e.currentTarget.closest("section");
                  if (col) {
                    const r = col.getBoundingClientRect();
                    e.dataTransfer.setDragImage(col, e.clientX - r.left, e.clientY - r.top);
                  }
                  e.dataTransfer.setData("application/x-esionage-column", key);
                  e.dataTransfer.effectAllowed = "move";
                  setDragCol(key);
                }}
                onDragEnd={() => {
                  setDragCol(null);
                  setColDrop(null);
                }}
                className={cn("flex h-8 items-center gap-2 px-1", !readOnly && "cursor-grab active:cursor-grabbing")}
              >
                {group.option ? (
                  <OptionChip option={group.option} className="font-medium" />
                ) : (
                  <span className="truncate text-sm text-fg-muted">{t("board.noValue", { property: groupBy.name })}</span>
                )}
                <span
                  className="text-xs text-fg-muted tabular-nums"
                  title={t("board.cardCount", { count: group.rows.length })}
                >
                  {group.rows.length}
                </span>
                <span className="flex-1" />
                {!readOnly && (
                  <button
                    type="button"
                    aria-label={t("board.addCard")}
                    title={t("board.addCard")}
                    onClick={() => addCard(group)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded text-fg-muted opacity-0 group-hover/col:opacity-100 hover:bg-fg/10 hover:text-fg focus-visible:opacity-100"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                )}
              </header>
              <div
                className="flex min-h-10 flex-col gap-2 pt-1"
                onDragOver={(e) => onDragOver(e, group)}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(null);
                }}
                onDrop={(e) => onDrop(e, group)}
              >
                {group.rows.map((row) => {
                  const visibleIndex = group.rows.filter((r) => r.id !== dragId).findIndex((r) => r.id === row.id);
                  return (
                    <div key={row.id}>
                      {dropping && drop.index === visibleIndex && row.id !== dragId && <DropLine />}
                      <Card
                        workspaceId={workspaceId}
                        row={row}
                        props={cardProps}
                        readOnly={readOnly}
                        dragging={dragId === row.id}
                        editTitle={editTitleOf === row.id}
                        onTitle={(title) => {
                          setEditTitleOf(null);
                          if (title !== row.title) void api.setCell(row.id, TITLE, title);
                        }}
                        onDelete={() => api.deleteRow(row.id)}
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", row.id);
                          e.dataTransfer.effectAllowed = "move";
                          setDragId(row.id);
                        }}
                        onDragEnd={() => {
                          setDragId(null);
                          setDrop(null);
                        }}
                      />
                    </div>
                  );
                })}
                {dropping && drop.index >= group.rows.filter((r) => r.id !== dragId).length && <DropLine />}
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => addCard(group)}
                    className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-sm text-fg-muted hover:bg-fg/5 hover:text-fg"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {t("board.new")}
                  </button>
                )}
              </div>
            </section>
          );
        })}
        {!readOnly && <NewGroup onCreate={(name) => api.createOption(groupBy.id, name)} />}
      </div>
    </div>
  );
}

function ColumnDropLine({ side }: { side: "left" | "right" }) {
  return (
    <div
      aria-hidden
      className={cn("absolute inset-y-0 w-0.5 rounded bg-accent", side === "left" ? "-left-[7px]" : "-right-[7px]")}
    />
  );
}

/** Adds an option to the grouping property, which shows up as a new column at the end. */
function NewGroup({ onCreate }: { onCreate: (name: string) => Promise<unknown> }) {
  const t = useTranslations("database.board");
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // Enter or Escape ends the edit; the blur that follows must not end it a second time.
  const done = useRef(false);
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);

  const start = () => {
    done.current = false;
    setEditing(true);
  };
  const finish = async (save: boolean) => {
    if (done.current) return;
    done.current = true;
    const value = name.trim();
    if (save && value) {
      setSaving(true);
      await onCreate(value);
      setSaving(false);
    }
    setName("");
    setEditing(false);
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={start}
        className="flex h-9 w-44 shrink-0 items-center gap-1.5 rounded-lg px-2 text-sm text-fg-muted hover:bg-bg-hover hover:text-fg"
      >
        <Plus className="h-3.5 w-3.5" />
        {t("newGroup")}
      </button>
    );
  }
  return (
    <div className="w-[17rem] shrink-0 rounded-xl bg-bg-subtle p-2">
      <input
        ref={input}
        value={name}
        disabled={saving}
        placeholder={t("namePlaceholder")}
        aria-label={t("groupNameLabel")}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => void finish(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void finish(true);
          if (e.key === "Escape") void finish(false);
        }}
        className="h-8 w-full rounded-md border border-border bg-bg px-2 text-sm outline-none focus:border-accent"
      />
    </div>
  );
}

function DropLine() {
  return <div className="mb-2 h-0.5 rounded bg-accent" />;
}

function Card({
  workspaceId,
  row,
  props,
  readOnly,
  dragging,
  editTitle,
  onTitle,
  onDelete,
  onDragStart,
  onDragEnd,
}: {
  workspaceId: string;
  row: Row;
  props: Property[];
  readOnly?: boolean;
  dragging: boolean;
  editTitle: boolean;
  onTitle: (title: string) => void;
  onDelete: () => void;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}) {
  const t = useTranslations("database");
  const tc = useTranslations("common");
  const router = useRouter();
  const menu = useFloating<HTMLButtonElement>();
  const href = `/w/${workspaceId}/p/${row.id}`;
  const shown = props.filter((p) => !isEmptyValue(p, row.properties[p.id]));

  return (
    <div
      data-card={row.id}
      draggable={!readOnly && !editTitle}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => !editTitle && router.push(href)}
      className={cn(
        "board-card group relative cursor-pointer rounded-lg px-3 py-2.5",
        dragging && "opacity-40",
      )}
    >
      {editTitle ? (
        <CardTitleInput initial={row.title} onDone={onTitle} />
      ) : (
        <div className="flex gap-1.5 pr-6 text-sm leading-5 font-medium">
          {row.icon && <span className="shrink-0">{row.icon}</span>}
          <span className={cn("min-w-0 break-words", !row.title && "text-fg-faint")}>
            {pageLabel(row.title, tc("untitled"))}
          </span>
        </div>
      )}
      {shown.length > 0 && (
        <div className="mt-2 flex flex-col items-start gap-1.5 text-xs">
          {shown.map((p) => (
            <div key={p.id} className="flex max-w-full min-w-0 items-center text-fg-muted" title={p.name}>
              <PropertyDisplay prop={p} value={row.properties[p.id]} />
            </div>
          ))}
        </div>
      )}
      {!readOnly && !editTitle && (
        <div className="absolute top-1.5 right-1.5" onClick={(e) => e.stopPropagation()}>
          <button
            ref={menu.ref}
            type="button"
            aria-label={t("board.cardActions")}
            onClick={menu.toggle}
            className={cn(
              "board-card flex h-6 w-6 items-center justify-center rounded-md text-fg-muted hover:text-fg",
              menu.open ? "visible" : "invisible group-hover:visible",
            )}
          >
            <Ellipsis className="h-3.5 w-3.5" />
          </button>
          <Floating open={menu.open} anchor={menu.el} onClose={menu.close} align="end">
            <MenuItem
              icon={<ExternalLink className="h-3.5 w-3.5" />}
              onClick={() => {
                menu.close();
                router.push(href);
              }}
            >
              {t("rowMenu.open")}
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              danger
              icon={<Trash2 className="h-3.5 w-3.5" />}
              onClick={() => {
                menu.close();
                onDelete();
              }}
            >
              {tc("delete")}
            </MenuItem>
          </Floating>
        </div>
      )}
    </div>
  );
}

export function CardTitleInput({ initial, onDone }: { initial: string; onDone: (title: string) => void }) {
  const t = useTranslations("database.board");
  const [value, setValue] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    onDone(value.trim());
  };
  useEffect(() => input.current?.focus(), []);
  return (
    <input
      ref={input}
      value={value}
      placeholder={t("namePlaceholder")}
      aria-label={t("nameLabel")}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "Escape") finish();
      }}
      className="w-full bg-transparent text-sm font-medium outline-none placeholder:text-fg-faint"
    />
  );
}
