"use client";

import { Ellipsis, ExternalLink, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { Button, cn, MenuItem, MenuSeparator } from "@/components/ui";
import { pageLabel } from "@/lib/labels";
import { groupRows, positionBetween, type RowGroup } from "@/lib/properties";
import { Floating, useFloating } from "./floating";
import { isEmptyValue, OptionChip, PropertyDisplay } from "./property-cell";
import { TITLE, type Property, type Row, type View } from "./types";
import type { DatabaseApi } from "./use-database";

const MAX_CARD_PROPS = 3;

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

  if (!groupBy) {
    return (
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
    );
  }

  const hidden = new Set(view.config.hidden ?? []);
  const cardProps = properties.filter((p) => p.id !== groupBy.id && !hidden.has(p.id));
  const groups = groupRows(rows, groupBy);
  const manualOrder = !(view.config.sorts?.length);
  const groupKey = (g: RowGroup<Row>) => g.option?.id ?? "";

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
    <div className="-mx-2 flex items-start gap-3 overflow-x-auto px-2 pb-4 [color-scheme:light_dark]">
      {groups.map((group) => {
        const key = groupKey(group);
        const dropping = dragId !== null && drop?.group === key;
        return (
          <section
            key={key || "__none"}
            aria-label={group.option?.name ?? t("board.noValue", { property: groupBy.name })}
            className={cn(
              "flex w-64 shrink-0 flex-col rounded-lg p-1.5 transition-colors",
              dropping ? "bg-bg-hover" : "bg-bg-subtle",
            )}
          >
            <header className="flex h-8 items-center gap-2 px-1.5">
              {group.option ? (
                <OptionChip option={group.option} />
              ) : (
                <span className="truncate text-sm text-fg-muted">{t("board.noValue", { property: groupBy.name })}</span>
              )}
              <span
                className="text-xs text-fg-faint tabular-nums"
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
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:bg-bg-active hover:text-fg"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              )}
            </header>
            <div
              className="flex min-h-10 flex-col gap-1.5 pt-1"
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
                  className="flex h-8 items-center gap-1.5 rounded-md px-1.5 text-sm text-fg-muted hover:bg-bg-hover hover:text-fg"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t("board.new")}
                </button>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function DropLine() {
  return <div className="mb-1.5 h-0.5 rounded bg-accent" />;
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
  const shown = props.filter((p) => !isEmptyValue(p, row.properties[p.id])).slice(0, MAX_CARD_PROPS);

  return (
    <div
      data-card={row.id}
      draggable={!readOnly && !editTitle}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => !editTitle && router.push(href)}
      className={cn(
        "group relative cursor-pointer rounded-md border border-border bg-bg px-2.5 py-2 shadow-sm hover:bg-bg-subtle",
        dragging && "opacity-40",
      )}
    >
      {editTitle ? (
        <CardTitleInput initial={row.title} onDone={onTitle} />
      ) : (
        <div className={cn("pr-6 text-sm font-medium break-words", !row.title && "text-fg-faint")}>
          {pageLabel(row.title, tc("untitled"))}
        </div>
      )}
      {shown.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-1 text-xs">
          {shown.map((p) => (
            <div key={p.id} className="flex min-w-0 items-center text-fg-muted" title={p.name}>
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
              "flex h-6 w-6 items-center justify-center rounded border border-border bg-bg text-fg-muted hover:text-fg",
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

function CardTitleInput({ initial, onDone }: { initial: string; onDone: (title: string) => void }) {
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
