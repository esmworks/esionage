"use client";

import { ArrowDown, ArrowUp, Ellipsis, ExternalLink, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { cn, MenuItem, MenuSeparator } from "@/components/ui";
import type { ViewConfig } from "@/db/schema/app";
import type { AggregateFn } from "@/lib/aggregate";
import { isSortable } from "@/lib/properties";
import { Floating, useFloating } from "./floating";
import { OpenLink, PropertyCell } from "./property-cell";
import { PropertyTypeIcon } from "./property-icons";
import { AddPropertyPanel, PropertyMenu } from "./property-menu";
import { CalculationRow } from "./table-calculations";
import { TITLE, type Property, type Row, type View } from "./types";
import type { DatabaseApi } from "./use-database";

const NAME_WIDTH = 280;
const WIDTHS: Partial<Record<Property["type"], number>> = { checkbox: 110, number: 140, date: 170 };
const colWidth = (p: Property) => WIDTHS[p.type] ?? 200;

/** The implicit Name column as a text property; `name` is its translated label. */
export function titleProperty(databaseId: string, name: string): Property {
  return {
    id: TITLE,
    databaseId,
    name,
    type: "text",
    options: {},
    position: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

export function TableView({
  workspaceId,
  databaseId,
  view,
  properties,
  rows,
  api,
  readOnly,
  locked,
  filtered,
}: {
  workspaceId: string;
  databaseId: string;
  view: View;
  properties: Property[];
  rows: Row[];
  api: DatabaseApi;
  readOnly?: boolean;
  /** The schema is locked: rows stay editable, properties don't. */
  locked?: boolean;
  /** True when filters hide rows, to explain an empty table. */
  filtered: boolean;
}) {
  const t = useTranslations("database");
  const tc = useTranslations("common");
  const [editTitleOf, setEditTitleOf] = useState<string | null>(null);
  const hidden = new Set(view.config.hidden ?? []);
  const visible = properties.filter((p) => !hidden.has(p.id));
  const titleProp = titleProperty(databaseId, t("nameColumn"));
  const sortOf = (id: string) => view.config.sorts?.find((s) => s.propertyId === id)?.direction;

  const setConfig = (config: ViewConfig) => api.updateView(view, { config });
  const setCalculation = (key: string, fn: AggregateFn | null) => {
    const calculations = { ...view.config.calculations };
    if (fn) calculations[key] = fn;
    else delete calculations[key];
    void setConfig({ ...view.config, calculations });
  };
  const createOption = api.createOption;

  const addRow = async () => {
    const id = await api.createRow();
    if (id) setEditTitleOf(id);
  };

  const totalWidth = 32 + NAME_WIDTH + visible.reduce((sum, p) => sum + colWidth(p), 0) + (readOnly ? 0 : 36);

  return (
    <div className="page-gutter-table overflow-x-auto pb-3 [color-scheme:light_dark]">
      <table className="table-fixed border-collapse text-sm" style={{ width: totalWidth }}>
        <colgroup>
          <col style={{ width: 32 }} />
          <col style={{ width: NAME_WIDTH }} />
          {visible.map((p) => (
            <col key={p.id} style={{ width: colWidth(p) }} />
          ))}
          {!readOnly && <col style={{ width: 36 }} />}
        </colgroup>
        <thead>
          <tr>
            <th aria-hidden />
            <HeaderCell
              prop={null}
              label={t("nameColumn")}
              icon="title"
              sort={sortOf(TITLE)}
              readOnly={readOnly}
              actions={{
                sort: (direction) => setConfig({ ...view.config, sorts: [{ propertyId: TITLE, direction }] }),
              }}
            />
            {visible.map((p) => (
              <HeaderCell
                key={p.id}
                prop={p}
                label={p.name}
                icon={p.type}
                sort={sortOf(p.id)}
                readOnly={readOnly}
                actions={{
                  rename: locked ? undefined : (name) => api.renameProperty(p.id, name),
                  sort: isSortable(p.type)
                    ? (direction) => setConfig({ ...view.config, sorts: [{ propertyId: p.id, direction }] })
                    : undefined,
                  hide: () => setConfig({ ...view.config, hidden: [...(view.config.hidden ?? []), p.id] }),
                  setOptions: locked ? undefined : (options) => api.setOptions(p, options),
                  remove: locked ? undefined : () => api.deleteProperty(p.id),
                }}
              />
            ))}
            {!readOnly && (
              <th className="border-y border-border p-0 text-left font-normal">
                {!locked && <AddPropertyButton onCreate={(name, type, relation) => api.addProperty(name, type, undefined, relation)} />}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="group">
              <td className="p-0 align-middle">
                {!readOnly && <RowMenu workspaceId={workspaceId} rowId={row.id} onDelete={() => api.deleteRow(row.id)} />}
              </td>
              <td className="relative border-b border-border p-0 align-top">
                <div className="font-medium">
                  <PropertyCell
                    prop={titleProp}
                    value={row.title}
                    readOnly={readOnly}
                    placeholder={tc("untitled")}
                    autoEdit={editTitleOf === row.id}
                    onChange={(v) => {
                      setEditTitleOf(null);
                      void api.setCell(row.id, TITLE, v ?? "");
                    }}
                    onCreateOption={createOption}
                  />
                </div>
                <span className="absolute inset-y-0 right-1 hidden items-center group-hover:flex">
                  <OpenLink href={`/w/${workspaceId}/p/${row.id}`} />
                </span>
              </td>
              {visible.map((p) => (
                <td key={p.id} className="border-b border-l border-border p-0 align-top">
                  <PropertyCell
                    prop={p}
                    value={row.properties[p.id]}
                    readOnly={readOnly}
                    onChange={(v) => void api.setCell(row.id, p.id, v)}
                    onCreateOption={createOption}
                  />
                </td>
              ))}
              {!readOnly && <td className="border-b border-l border-border" />}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <div className="ml-8 border-b border-border px-2 py-6 text-sm text-fg-faint" style={{ width: totalWidth - 32 }}>
          {filtered ? t("table.noMatches") : t("table.noRows")}
        </div>
      )}
      {!readOnly && (
        <button
          type="button"
          onClick={addRow}
          className="ml-8 flex h-[33px] items-center gap-1.5 rounded-md px-2 text-sm text-fg-muted hover:bg-bg-hover hover:text-fg"
          style={{ width: totalWidth - 32 }}
        >
          <Plus className="h-4 w-4" />
          {t("table.new")}
        </button>
      )}
      <CalculationRow
        offset={32}
        columns={[
          { key: TITLE, name: t("nameColumn"), type: TITLE, width: NAME_WIDTH },
          ...visible.map((p) => ({ key: p.id, name: p.name, type: p.type, options: p.options, width: colWidth(p) })),
        ]}
        rows={rows}
        calculations={view.config.calculations}
        readOnly={readOnly}
        onChange={setCalculation}
      />
    </div>
  );
}

function HeaderCell({
  prop,
  label,
  icon,
  sort,
  readOnly,
  actions,
}: {
  prop: Property | null;
  label: string;
  icon: Property["type"] | "title";
  sort?: "asc" | "desc";
  readOnly?: boolean;
  actions: React.ComponentProps<typeof PropertyMenu>["actions"];
}) {
  const t = useTranslations("database.table");
  const menu = useFloating<HTMLButtonElement>();
  return (
    <th className={cn("border-y border-border p-0 text-left font-normal", prop && "border-l")}>
      <button
        ref={menu.ref}
        type="button"
        disabled={readOnly}
        onClick={menu.toggle}
        className="flex h-[33px] w-full items-center gap-1.5 px-2 text-sm text-fg-muted hover:bg-bg-hover disabled:hover:bg-transparent"
      >
        <PropertyTypeIcon type={icon} className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{label}</span>
        {sort === "asc" && <ArrowUp className="h-3 w-3 shrink-0 text-accent" aria-label={t("sortedAscending")} />}
        {sort === "desc" && <ArrowDown className="h-3 w-3 shrink-0 text-accent" aria-label={t("sortedDescending")} />}
      </button>
      <Floating open={menu.open} anchor={menu.el} onClose={menu.close}>
        <PropertyMenu prop={prop} actions={actions} onDone={menu.close} />
      </Floating>
    </th>
  );
}

function AddPropertyButton({ onCreate }: { onCreate: React.ComponentProps<typeof AddPropertyPanel>["onCreate"] }) {
  const t = useTranslations("database.table");
  const menu = useFloating<HTMLButtonElement>();
  return (
    <>
      <button
        ref={menu.ref}
        type="button"
        aria-label={t("addProperty")}
        title={t("addProperty")}
        onClick={menu.toggle}
        className="flex h-[33px] w-full items-center justify-center text-fg-muted hover:bg-bg-hover hover:text-fg"
      >
        <Plus className="h-4 w-4" />
      </button>
      <Floating open={menu.open} anchor={menu.el} onClose={menu.close} align="end">
        <AddPropertyPanel onCreate={onCreate} onDone={menu.close} />
      </Floating>
    </>
  );
}

function RowMenu({ workspaceId, rowId, onDelete }: { workspaceId: string; rowId: string; onDelete: () => void }) {
  const t = useTranslations("database");
  const tc = useTranslations("common");
  const menu = useFloating<HTMLButtonElement>();
  const router = useRouter();
  return (
    <>
      <button
        ref={menu.ref}
        type="button"
        aria-label={t("table.rowActions")}
        onClick={menu.toggle}
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded text-fg-faint hover:bg-bg-hover hover:text-fg",
          menu.open ? "visible" : "invisible group-hover:visible",
        )}
      >
        <Ellipsis className="h-4 w-4" />
      </button>
      <Floating open={menu.open} anchor={menu.el} onClose={menu.close}>
        <MenuItem
          icon={<ExternalLink className="h-3.5 w-3.5" />}
          onClick={() => {
            menu.close();
            router.push(`/w/${workspaceId}/p/${rowId}`);
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
    </>
  );
}
